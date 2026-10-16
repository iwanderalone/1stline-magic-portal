"""Equipment intake: one invoice in, NetBox devices out.

    invoice PDF ──► (Gemini reads it, a human corrects) ──► IntakeRequest
                         │
                         ├─ supplier added to NetBox's choice set if new
                         ├─ device types / manufacturers created if missing
                         ├─ invoice uploaded once, bound to every device
                         ├─ one NetBox device per unit, procurement custom fields filled
                         └─ asset tags: assigned by the webhook receiver on the
                            NetBox host (per-tenant ranges) — we only wait for them

NetBox has no transactions and the portal cannot delete there, so a failure
part-way leaves what was created. Re-running the same intake is safe for
serialised units: a serial already in NetBox under the same invoice number is
reused instead of duplicated.
"""
import asyncio
import base64
import json
import logging
import re
from datetime import date
from typing import Optional

import httpx

from app.core.config import get_settings
from app.core.dynamic_settings import eff
from app.schemas.schemas import (
    IntakeDevice, IntakeRequest, NetboxLookupItem, ParsedInvoice, ParsedInvoiceItem,
)
from app.services import netbox_service as nbs

logger = logging.getLogger(__name__)

INVOICE_TYPES = {"pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg"}
INVOICE_MAX_BYTES = 15 * 1024 * 1024


class IntakeError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


# ─── Reading the invoice (Gemini) ─────────────────────────────────────

_PARSE_PROMPT = """You are reading a supplier invoice for IT equipment bought by a company in the UAE.
Extract the fields below. Rules:
- Only report what is printed on the document; use null when a value is absent. Never invent serial numbers.
- items: one entry per invoice line (skip delivery fees and discounts). is_device = true only for a physical item
  worth tracking as an asset (laptop, monitor, phone, camera, dock, headset, furniture...); false for software
  licences, subscriptions, services, warranties, cables/consumables of negligible value and free bundled extras.
- manufacturer: the brand (Apple, Lenovo, Dell, Logitech, ...).
- model: the full product name of the line WITHOUT the brand, keeping the configuration exactly as printed
  (CPU, RAM, storage, screen, colour, part number). Do not shorten it.
- unit_price_net: price per unit WITHOUT VAT, in the invoice currency.
- serials: every serial number printed for that line, copied character for character. Look everywhere: inside the
  description ("S/N:", "SN", "Serial No", "IMEI"), on lines under the item, and in a separate serial-number table or
  appendix — map each to its item. Do not put serial numbers into model. Part/model numbers (e.g. ZGM-00062,
  MLY33ZS/A, 21FJ0007AD) are NOT serial numbers.
- total: the grand total INCLUDING VAT. vat: the VAT amount.
- invoice_date as YYYY-MM-DD. currency as a 3-letter ISO code."""

_PARSE_SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "supplier": {"type": "STRING", "nullable": True},
        "invoice_no": {"type": "STRING", "nullable": True},
        "invoice_date": {"type": "STRING", "nullable": True},
        "currency": {"type": "STRING", "nullable": True},
        "total": {"type": "NUMBER", "nullable": True},
        "vat": {"type": "NUMBER", "nullable": True},
        "items": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "description": {"type": "STRING", "nullable": True},
                    "is_device": {"type": "BOOLEAN", "nullable": True},
                    "manufacturer": {"type": "STRING", "nullable": True},
                    "model": {"type": "STRING", "nullable": True},
                    "quantity": {"type": "INTEGER", "nullable": True},
                    "unit_price_net": {"type": "NUMBER", "nullable": True},
                    "serials": {"type": "ARRAY", "items": {"type": "STRING"}},
                },
            },
        },
    },
}


def gemini_enabled() -> bool:
    return bool(eff("GEMINI_API_KEY", get_settings().GEMINI_API_KEY))


async def _gemini_extract(content: bytes, mime: str) -> dict:
    s = get_settings()
    key = eff("GEMINI_API_KEY", s.GEMINI_API_KEY)
    model = eff("GEMINI_MODEL", s.GEMINI_MODEL)
    if not key:
        raise IntakeError("Invoice reading needs GEMINI_API_KEY", status_code=503)
    body = {
        "contents": [{"role": "user", "parts": [
            {"inline_data": {"mime_type": mime, "data": base64.b64encode(content).decode()}},
            {"text": _PARSE_PROMPT},
        ]}],
        "generationConfig": {
            "temperature": 0,
            "responseMimeType": "application/json",
            "responseSchema": _PARSE_SCHEMA,
            "maxOutputTokens": 4096,
        },
    }
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    # Google 503s ("high demand") come in bursts; a short backoff usually clears them.
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            for attempt in range(4):
                resp = await client.post(url, params={"key": key}, json=body)
                if resp.status_code not in (500, 503):
                    break
                logger.warning("[intake] Gemini %s, attempt %d/4", resp.status_code, attempt + 1)
                await asyncio.sleep(2 * (attempt + 1))
    except httpx.HTTPError as exc:
        raise IntakeError(f"Cannot reach Gemini: {exc}") from exc
    if resp.status_code in (500, 503):
        raise IntakeError("Gemini is overloaded on Google's side — try again in a minute or fill the form by hand", 503)
    if resp.status_code == 429:
        raise IntakeError("Gemini is rate-limited right now — fill the form by hand or retry in a minute", 429)
    if resp.status_code >= 400:
        logger.warning("[intake] Gemini %s: %s", resp.status_code, resp.text[:300])
        raise IntakeError(f"Gemini error ({resp.status_code})")
    try:
        parts = resp.json()["candidates"][0]["content"]["parts"]
        return json.loads("".join(p.get("text", "") for p in parts))
    except (KeyError, IndexError, ValueError) as exc:
        raise IntakeError("Gemini returned something that is not an invoice reading") from exc


def _num(v) -> Optional[float]:
    try:
        return round(float(v), 2) if v is not None else None
    except (TypeError, ValueError):
        return None


def _date(v) -> Optional[date]:
    try:
        return date.fromisoformat(str(v)[:10]) if v else None
    except ValueError:
        return None


def _norm(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").casefold()).strip()


_COMPANY_NOISE = {"llc", "l l c", "fze", "fzco", "fz", "co", "trading", "ltd", "limited", "inc", "est", "llc."}


def match_supplier(raw: Optional[str], choices: list[str]) -> Optional[str]:
    """Map the printed supplier name onto NetBox's fixed choice set.
    'MICRO SPEED COMPUTERS L.L.C' → 'micro speed computers'. Conservative:
    no match is better than a wrong one — the human picks then."""
    if not raw:
        return None
    words = [w for w in _norm(raw).split() if w not in _COMPANY_NOISE]
    target = " ".join(words)
    if not target:
        return None
    for c in choices:
        if _norm(c) == target:
            return c
    for c in choices:
        nc = _norm(c)
        if len(nc) >= 4 and (nc in target or target in nc):
            return c
    return None


# 'MLY33ZS/A', 'ZGM-00062', '21FJ0007AD' — letters and digits mixed, or slashed/dashed.
_PART_NO = re.compile(r"\b[A-Z0-9]{3,}[/-][A-Z0-9/-]+\b|\b(?=[A-Z0-9]*\d)(?=[A-Z0-9]*[A-Z])[A-Z0-9]{6,}\b")


def _tokens(text: str) -> set[str]:
    return {t for t in _norm(text).split() if len(t) >= 2}


def _similarity(a: str, b: str) -> float:
    ta, tb = _tokens(a), _tokens(b)
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


async def _match_device_type(manufacturer: Optional[str], model: Optional[str],
                             description: Optional[str]) -> Optional[NetboxLookupItem]:
    """Best existing NetBox type for an invoice line, only on a confident hit.
    Invoice wording and NetBox type names differ ('MS SURFACE 7TH EDITION
    13.8"…' vs 'MS Surface 7th Ed 13.8" Touch…'), so candidates are scored by
    token overlap with the full line text; a unique part number wins outright."""
    text = " ".join(filter(None, [manufacturer, model, description]))
    if not text.strip():
        return None
    part_numbers = list(dict.fromkeys(_PART_NO.findall(text.upper())))[:3]
    words = (model or description or "").split()
    queries = part_numbers + ([" ".join(words[:2])] if words else [])
    candidates: dict[int, NetboxLookupItem] = {}
    for q in queries:
        for t in await nbs.list_device_types(q=q):
            candidates[t.id] = t
    if not candidates:
        return None
    for pn in part_numbers:   # a part number found in exactly one type settles it
        hits = [t for t in candidates.values() if pn.casefold() in (t.name or "").casefold()]
        if len(hits) == 1:
            return hits[0]
    scored = sorted(((_similarity(text, (t.display or t.name)), t) for t in candidates.values()),
                    key=lambda x: x[0], reverse=True)
    best, runner = scored[0], (scored[1][0] if len(scored) > 1 else 0.0)
    if best[0] >= 0.45 and best[0] - runner >= 0.1:
        return best[1]
    return None


_SERIAL_MARKER = re.compile(r"(?:S/?N|SERIAL(?:\s*(?:NO|NUMBER|#))?|IMEI)\s*[:#.]?\s*", re.I)


def _clean_serials(serials, *line_text: Optional[str]) -> list[str]:
    """Upper-cased (NetBox serials are; models tend to lower-case what they
    read), and without part numbers the model mistook for serials: a value
    that appears in the product name is dropped — unless it appears there
    right after an 'S/N' marker, which is just a serial printed inline."""
    text = " ".join(filter(None, line_text)).upper()
    marked = {m.group(1).upper() for m in re.finditer(_SERIAL_MARKER.pattern + r"([A-Z0-9-]{4,})", text, re.I)}
    out = []
    for s in serials or []:
        s = (s or "").strip().upper()
        if not s or s in out:
            continue
        if s in text and s not in marked:
            continue
        out.append(s)
    return out


async def parse_invoice(content: bytes, mime: str) -> ParsedInvoice:
    data = await _gemini_extract(content, mime)
    suppliers = await nbs.list_suppliers() if nbs.enabled() else []
    items = []
    for raw in data.get("items") or []:
        item = ParsedInvoiceItem(
            description=raw.get("description"),
            is_device=raw.get("is_device") is not False,
            manufacturer=raw.get("manufacturer"),
            model=raw.get("model") or raw.get("description"),
            quantity=max(1, min(int(raw.get("quantity") or 1), 50)),
            unit_price_net=_num(raw.get("unit_price_net")),
            serials=_clean_serials(raw.get("serials"), raw.get("model"), raw.get("description")),
        )
        if nbs.enabled() and item.is_device:
            try:
                item.device_type = await _match_device_type(item.manufacturer, item.model, item.description)
            except nbs.NetboxError:
                item.device_type = None
        items.append(item)
    currency = (data.get("currency") or "").strip().upper() or None
    return ParsedInvoice(
        supplier_raw=data.get("supplier"),
        supplier=match_supplier(data.get("supplier"), suppliers),
        invoice_no=(data.get("invoice_no") or "").strip() or None,
        invoice_date=_date(data.get("invoice_date")),
        currency=currency if currency and len(currency) == 3 else None,
        total=_num(data.get("total")),
        vat=_num(data.get("vat")),
        items=items,
    )


# ─── Writing to NetBox ────────────────────────────────────────────────

def attachment_name(delivery: date, invoice_no: str, supplier: str) -> str:
    """Same naming the existing invoice attachments use: 'YYYY-MM-DD -- No -- Supplier'."""
    return f"{delivery.isoformat()} -- {invoice_no} -- {supplier}"


def attachment_filename(name: str, ext: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name.replace(" ", "_")).strip("_")[:150] + f".{ext}"


def _price(value: Optional[float]) -> Optional[str]:
    if value is None:
        return None
    # Net_Price_without_VAT is a text field; the team writes it with a decimal
    # comma and always two places: 3200 -> "3200,00".
    return f"{float(value):.2f}".replace(".", ",")


async def run_intake(req: IntakeRequest, invoice: bytes, ext: str) -> tuple[list[IntakeDevice], dict, str, list[str], Optional[str]]:
    """Create everything in NetBox. Returns (devices, invoice attachment,
    supplier value used, warnings, error). On a NetBox error mid-way the error
    is returned, not raised, so the caller can still show what was created."""
    warnings: list[str] = []
    devices: list[IntakeDevice] = []

    # Serial clashes are checked before anything is written: a device that
    # exists under this same invoice is a retry and gets reused, one under any
    # other invoice is a real conflict and stops the whole intake up front.
    existing_by_serial: dict[str, dict] = {}
    for item in req.items:
        for serial in item.serials:
            found = await nbs.find_device_by_serial(serial)
            if not found:
                continue
            if (found.get("custom_fields") or {}).get("invoice_no") != req.invoice_no:
                raise IntakeError(f"Serial {serial} is already in NetBox (device #{found['id']}, "
                                  f"asset tag {found.get('asset_tag') or '—'}) under another invoice", 409)
            existing_by_serial[serial] = found

    supplier = await nbs.ensure_supplier(req.supplier, create=req.add_supplier)
    if supplier is None:
        raise IntakeError(f"Supplier '{req.supplier}' is not in NetBox — confirm adding it or pick an existing one", 409)
    if supplier != req.supplier.strip():
        warnings.append(f"Supplier recorded as '{supplier}' (existing NetBox value)")

    # Types first: a typo there should fail before anything else is written.
    type_ids: list[tuple[int, str]] = []
    for item in req.items:
        if item.device_type_id:
            type_ids.append((item.device_type_id, ""))
        else:
            t = await nbs.ensure_device_type(item.new_type.manufacturer, item.new_type.model)
            type_ids.append((t.id, t.display or t.name))

    name = attachment_name(req.delivery_date, req.invoice_no, supplier)
    attachment = await nbs.upload_attachment(
        filename=attachment_filename(name, ext), content=invoice,
        display_name=name, content_type=INVOICE_TYPES.get(ext, "application/octet-stream"),
    )

    try:
        for item, (type_id, _label) in zip(req.items, type_ids):
            for n in range(item.quantity):
                serial = item.serials[n] if n < len(item.serials) else None
                existing = existing_by_serial.get(serial) if serial else None
                if existing:
                    devices.append(IntakeDevice(
                        id=existing["id"],
                        label=(existing.get("device_type") or {}).get("display") or f"#{existing['id']}",
                        serial=serial, asset_tag=existing.get("asset_tag"),
                        url=nbs.device_web_url(existing["id"]), reused=True,
                    ))
                    continue
                body = {
                    "device_type": type_id,
                    "role": item.role_id,
                    "site": item.site_id,
                    "tenant": item.tenant_id,
                    "status": "active",
                    "custom_fields": {
                        "supplier": supplier,
                        "invoice_no": req.invoice_no,
                        "delivery_date": req.delivery_date.isoformat(),
                        "invoice_attachment": attachment["id"],
                    },
                }
                if item.location_id:
                    body["location"] = item.location_id
                if serial:
                    body["serial"] = serial
                if item.unit_price_net is not None:
                    body["custom_fields"]["Net_Price_without_VAT"] = _price(item.unit_price_net)
                if item.comments:
                    body["comments"] = item.comments
                created = await nbs.create_device_raw(body)
                await nbs.bind_attachment(attachment["id"], created.id)
                devices.append(IntakeDevice(
                    id=created.id,
                    label=(created.device_type.display if created.device_type else None) or f"#{created.id}",
                    serial=serial, asset_tag=created.asset_tag, url=nbs.device_web_url(created.id),
                ))
    except (nbs.NetboxError, IntakeError) as exc:
        logger.warning("[intake] stopped after %d device(s): %s", len(devices), exc)
        return devices, attachment, supplier, warnings, str(exc)

    tags = await nbs.wait_for_asset_tags([d.id for d in devices if not d.asset_tag])
    for d in devices:
        d.asset_tag = d.asset_tag or tags.get(d.id)
    if any(not d.asset_tag for d in devices):
        warnings.append("Some asset tags have not arrived yet — NetBox assigns them shortly; "
                        "check the tenant has asset_tag_start set")
    return devices, attachment, supplier, warnings, None
