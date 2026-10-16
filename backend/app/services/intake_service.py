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
- items: one entry per invoice line for physical goods. Skip delivery fees, discounts, warranty-only and service lines.
- manufacturer: the brand (Apple, Lenovo, Dell, Logitech, ...). model: the product model as specific as printed,
  including the configuration (CPU/RAM/storage/colour/part number) when shown.
- unit_price_net: price per unit WITHOUT VAT, in the invoice currency.
- serials: serial numbers printed for that line, if any.
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
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            resp = await client.post(url, params={"key": key}, json=body)
    except httpx.HTTPError as exc:
        raise IntakeError(f"Cannot reach Gemini: {exc}") from exc
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


async def _match_device_type(manufacturer: Optional[str], model: Optional[str]) -> Optional[NetboxLookupItem]:
    """Best existing NetBox type for an invoice line, only on a confident hit."""
    if not model:
        return None
    candidates = await nbs.list_device_types(q=model)
    want = _norm(model)
    for t in candidates:
        if _norm(t.name) == want:
            return t
    # A part number (MLY33ZS/A) is the most reliable token when it is printed.
    for token in re.findall(r"[A-Z0-9]{4,}[/-]?[A-Z0-9]*", model):
        hits = [t for t in candidates if token.casefold() in (t.name or "").casefold()]
        if len(hits) == 1:
            return hits[0]
    return None


async def parse_invoice(content: bytes, mime: str) -> ParsedInvoice:
    data = await _gemini_extract(content, mime)
    suppliers = await nbs.list_suppliers() if nbs.enabled() else []
    items = []
    for raw in data.get("items") or []:
        item = ParsedInvoiceItem(
            description=raw.get("description"),
            manufacturer=raw.get("manufacturer"),
            model=raw.get("model") or raw.get("description"),
            quantity=max(1, min(int(raw.get("quantity") or 1), 50)),
            unit_price_net=_num(raw.get("unit_price_net")),
            serials=[s.strip() for s in raw.get("serials") or [] if s and s.strip()],
        )
        if nbs.enabled():
            try:
                item.device_type = await _match_device_type(item.manufacturer, item.model)
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
    return str(int(value)) if float(value).is_integer() else f"{value:.2f}"


async def run_intake(req: IntakeRequest, invoice: bytes, ext: str) -> tuple[list[IntakeDevice], dict, str, list[str], Optional[str]]:
    """Create everything in NetBox. Returns (devices, invoice attachment,
    supplier value used, warnings, error). On a NetBox error mid-way the error
    is returned, not raised, so the caller can still show what was created."""
    warnings: list[str] = []
    devices: list[IntakeDevice] = []

    supplier = await nbs.ensure_supplier(req.supplier)
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
                if serial:
                    existing = await nbs.find_device_by_serial(serial)
                    if existing:
                        same_invoice = (existing.get("custom_fields") or {}).get("invoice_no") == req.invoice_no
                        if not same_invoice:
                            raise IntakeError(
                                f"Serial {serial} is already in NetBox (device #{existing['id']}) "
                                f"under another invoice", status_code=409)
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
