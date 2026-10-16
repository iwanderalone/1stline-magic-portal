"""NetBox client for the Inventory tool (Tools section).

Thin async wrapper around NetBox's REST API: list/search/get/create/update
devices plus a handful of lookup endpoints for form dropdowns. There is
deliberately no delete function anywhere in this module — devices are never
removed from the portal, matching the product requirement.

Targets NetBox v4 field naming (``role`` on the device object). NetBox v3
used ``device_role`` for the same relationship — if this ever gets pointed
at a v3 instance, the field name on create/update payloads and the response
parsing below will need a compat shim. Confirm the NetBox version before
go-live.
"""
import asyncio
import logging
import re
import time
import uuid
from typing import Any, Optional

import httpx

from app.core.config import get_settings
from app.schemas.schemas import (
    NetboxDeviceCreate,
    NetboxDeviceDetail,
    NetboxDevicesPage,
    NetboxDeviceUpdate,
    NetboxLookupItem,
)

logger = logging.getLogger(__name__)

DEVICES_PATH = "/api/dcim/devices/"
DEVICE_TYPES_PATH = "/api/dcim/device-types/"
SITES_PATH = "/api/dcim/sites/"
DEVICE_ROLES_PATH = "/api/dcim/device-roles/"
MANUFACTURERS_PATH = "/api/dcim/manufacturers/"
CONTACTS_PATH = "/api/tenancy/contacts/"
ASSIGNMENTS_PATH = "/api/tenancy/contact-assignments/"
TENANTS_PATH = "/api/tenancy/tenants/"
LOCATIONS_PATH = "/api/dcim/locations/"
CHOICE_SETS_PATH = "/api/extras/custom-field-choice-sets/"
CONTACT_ROLES_PATH = "/api/tenancy/contact-roles/"
ATTACHMENTS_PATH = "/api/plugins/netbox-attachments/netbox-attachments/"
ATTACHMENT_ASSIGN_PATH = "/api/plugins/netbox-attachments/netbox-attachment-assignments/"

DEVICE_OBJECT_TYPE = "dcim.device"
SUPPLIER_CHOICE_SET = "suppliers"
HANDOVER_ROLE_SLUG = "handover"

# Roles that hold something other than hardware. NetBox has no object class, so
# the role is what separates a licence from a laptop (see the integration plan).
NON_HARDWARE_ROLES = {"software", "subscription"}


class NetboxError(Exception):
    """Raised on any NetBox request failure; carries an HTTP status to surface."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


class NetboxNotFoundError(NetboxError):
    def __init__(self, message: str = "Device not found in NetBox"):
        super().__init__(message, status_code=404)


def enabled() -> bool:
    from app.core.dynamic_settings import eff
    s = get_settings()
    return bool(s.NETBOX_URL and eff("NETBOX_API_TOKEN", s.NETBOX_API_TOKEN))


def _client_kwargs() -> tuple[str, dict]:
    from app.core.dynamic_settings import eff
    s = get_settings()
    base_url = s.NETBOX_URL.rstrip("/")
    headers = {
        "Authorization": f"Token {eff('NETBOX_API_TOKEN', s.NETBOX_API_TOKEN)}",
        "Accept": "application/json",
    }
    return base_url, headers


async def _request(method: str, path: str, **kwargs) -> httpx.Response:
    base_url, headers = _client_kwargs()
    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.request(method, f"{base_url}{path}", headers=headers, **kwargs)
            response.raise_for_status()
            return response
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 404:
            raise NetboxNotFoundError() from exc
        detail = exc.response.text[:300]
        logger.warning("[netbox] %s %s -> %s: %s", method, path, exc.response.status_code, detail)
        if exc.response.status_code == 403:
            # The raw upstream string says only "you do not have permission",
            # which sends the reader to the container logs to find out for what.
            raise NetboxError(
                f"The portal's NetBox token lacks permission for {path.strip('/')}. "
                f"Grant its NetBox user access to that object type.",
                status_code=403,
            ) from exc
        raise NetboxError(f"NetBox rejected the request: {detail}", status_code=exc.response.status_code) from exc
    except httpx.HTTPError as exc:
        logger.warning("[netbox] %s %s failed: %s", method, path, exc)
        raise NetboxError("Cannot reach NetBox", status_code=502) from exc


def device_web_url(device_id: int) -> str:
    """The NetBox UI page (the API `url` field points at the REST endpoint)."""
    return f"{get_settings().NETBOX_URL.rstrip('/')}/dcim/devices/{device_id}/"


def _ref(data: Optional[dict]) -> Optional[dict]:
    """Normalize both NetBox nested-serializer relations (id/name/slug/display,
    e.g. device_type/role/site) and choice fields (value/label only, e.g.
    status — no id). ``name`` prefers ``value`` so it carries the raw code
    NetBox expects back on write; ``display`` carries the human label."""
    if not isinstance(data, dict):
        return None
    return {
        "id": data.get("id"),
        "name": data.get("value") or data.get("name") or data.get("label"),
        "slug": data.get("slug"),
        "display": data.get("display") or data.get("label"),
    }


def _to_summary(raw: dict) -> dict:
    return {
        "id": raw["id"],
        "name": raw.get("name"),
        "display": raw.get("display"),
        "device_type": _ref(raw.get("device_type")),
        "role": _ref(raw.get("role") or raw.get("device_role")),
        "site": _ref(raw.get("site")),
        "status": _ref(raw.get("status")),
        "serial": raw.get("serial"),
        "asset_tag": raw.get("asset_tag"),
        "primary_ip": raw.get("primary_ip"),
        "url": raw.get("url"),
    }


def _to_detail(raw: dict) -> dict:
    cf = raw.get("custom_fields") or {}
    return {
        **_to_summary(raw),
        "manufacturer": _ref((raw.get("device_type") or {}).get("manufacturer")),
        "platform": _ref(raw.get("platform")),
        "location": _ref(raw.get("location")),
        "rack": _ref(raw.get("rack")),
        "tenant": _ref(raw.get("tenant")),
        "comments": raw.get("comments"),
        "custom_fields": cf,
        # The procurement record lives entirely in custom fields; pull it out so
        # the UI does not have to know NetBox's field names.
        "procurement": {
            "supplier": cf.get("supplier"),
            "invoice_no": cf.get("invoice_no"),
            "delivery_date": cf.get("delivery_date"),
            "net_price": cf.get("Net_Price_without_VAT"),
            "accounting": cf.get("Accounting_Odoo"),
            "invoice_attachment": _attachment(cf.get("invoice_attachment")),
            "kit_parent": _ref(cf.get("Invoice_Relationship")),
        },
        "last_updated": raw.get("last_updated"),
    }


def _attachment(data: Optional[dict]) -> Optional[dict]:
    """netbox_attachments object → the few fields the UI needs."""
    if not isinstance(data, dict):
        return None
    return {
        "id": data.get("id"),
        "name": data.get("name") or data.get("display"),
        "file": data.get("file"),
    }


def _to_contact(raw: dict) -> dict:
    cf = raw.get("custom_fields") or {}
    return {
        "id": raw["id"],
        "name": raw.get("name") or raw.get("display"),
        "first_name": cf.get("firstname"),
        "last_name": cf.get("lastname"),
        "title": raw.get("title"),
        "email": raw.get("email"),
        "phone": raw.get("phone"),
        "description": raw.get("description"),
        "url": raw.get("url"),
        "offboarded": is_offboarded(raw),
    }


# The AD → NetBox sync has no status field for contacts; it marks a leaver by
# prefixing the name with "[Disabled]" and/or this sentence in comments.
# Either counts, matched loosely so a reworded sync still does.
_OFFBOARDED_MARKER = "disabled or removed from ad"


def is_offboarded(raw: dict) -> bool:
    name = (raw.get("name") or raw.get("display") or "").lower()
    return name.startswith("[disabled]") or _OFFBOARDED_MARKER in (raw.get("comments") or "").lower()


async def get_contacts_by_ids(ids: list[int]) -> dict[int, dict]:
    """Bulk fetch for seat audits — NetBox accepts a repeated id= filter."""
    out: dict[int, dict] = {}
    unique = sorted(set(ids))
    for i in range(0, len(unique), 100):
        chunk = unique[i:i + 100]
        response = await _request("GET", CONTACTS_PATH, params=[("id", c) for c in chunk] + [("limit", 100)])
        for raw in response.json().get("results", []):
            out[raw["id"]] = _to_contact(raw)
    return out


def _to_assignment(raw: dict) -> dict:
    """A contact-assignment is how NetBox records possession — the handover."""
    cf = raw.get("custom_fields") or {}
    obj = raw.get("object") or {}
    return {
        "id": raw["id"],
        "contact": _to_contact(raw.get("contact") or {}) if raw.get("contact") else None,
        "role": _ref(raw.get("role")),
        "object_id": obj.get("id"),
        "object_display": obj.get("display") or obj.get("name"),
        "object_type": raw.get("object_type"),
        "status": cf.get("status"),
        "signed_by": _ref(cf.get("signed_by")),
        "handover_attachment": _attachment(cf.get("handover_attachment")),
    }


_role_slug_cache: dict[str, Any] = {"slugs": None, "at": 0.0}
_ROLE_CACHE_TTL = 300  # seconds; roles change rarely


async def _non_hardware_slugs() -> list[str]:
    """Which of the non-hardware roles exist in this NetBox, cached briefly."""
    import time
    now = time.monotonic()
    if _role_slug_cache["slugs"] is not None and now - _role_slug_cache["at"] < _ROLE_CACHE_TTL:
        return _role_slug_cache["slugs"]
    response = await _request("GET", DEVICE_ROLES_PATH, params={"limit": 250})
    slugs = {r.get("slug") for r in response.json().get("results", [])}
    present = sorted(NON_HARDWARE_ROLES & slugs)
    _role_slug_cache.update({"slugs": present, "at": now})
    return present


async def list_devices(
    q: Optional[str] = None,
    site: Optional[int] = None,
    role: Optional[int] = None,
    status: Optional[str] = None,
    serial: Optional[str] = None,
    asset_tag: Optional[str] = None,
    device_class: Optional[str] = None,
    page: int = 1,
    page_size: int = 25,
) -> NetboxDevicesPage:
    params: dict[str, Any] = {"limit": page_size, "offset": (page - 1) * page_size}
    if q:
        params["q"] = q
    if site:
        params["site_id"] = site
    if role:
        params["role_id"] = role
    if status:
        params["status"] = status
    # Exact-match lookups: pasting a scanned serial should land on the device,
    # not on everything containing that substring.
    if serial:
        params["serial"] = serial
    if asset_tag:
        params["asset_tag"] = asset_tag
    # Hardware / software / subscription is a role distinction, not a NetBox
    # concept. NetBox validates role slugs, so filtering on one that does not
    # exist yet (Subscription, today) is a 400 rather than an empty result —
    # hence the intersection with the roles actually defined.
    if device_class:
        present = await _non_hardware_slugs()
        if device_class == "hardware":
            if present:
                params["role__n"] = present            # NetBox negation is __n
        elif device_class in present:
            params["role"] = device_class
        else:
            return NetboxDevicesPage(items=[], total=0, page=page, page_size=page_size)
    response = await _request("GET", DEVICES_PATH, params=params)
    data = response.json()
    items = [_to_summary(d) for d in data.get("results", [])]
    return NetboxDevicesPage(items=items, total=data.get("count", 0), page=page, page_size=page_size)


async def get_device(device_id: int) -> NetboxDeviceDetail:
    response = await _request("GET", f"{DEVICES_PATH}{device_id}/")
    return NetboxDeviceDetail.model_validate(_to_detail(response.json()))


async def create_device(payload: NetboxDeviceCreate) -> NetboxDeviceDetail:
    body = payload.model_dump()
    response = await _request("POST", DEVICES_PATH, json=body)
    return NetboxDeviceDetail.model_validate(_to_detail(response.json()))


async def update_device(device_id: int, payload: NetboxDeviceUpdate) -> NetboxDeviceDetail:
    body = payload.model_dump(exclude_unset=True)
    response = await _request("PATCH", f"{DEVICES_PATH}{device_id}/", json=body)
    return NetboxDeviceDetail.model_validate(_to_detail(response.json()))


async def _list_lookup(path: str, q: Optional[str] = None, limit: int = 250) -> list[NetboxLookupItem]:
    params: dict[str, Any] = {"limit": limit}
    if q:
        params["q"] = q
    response = await _request("GET", path, params=params)
    return [
        NetboxLookupItem(
            id=item["id"],
            name=item.get("name") or item.get("model") or item.get("display") or str(item["id"]),
            slug=item.get("slug"),
            display=item.get("display"),
        )
        for item in response.json().get("results", [])
    ]


async def list_device_types(q: Optional[str] = None) -> list[NetboxLookupItem]:
    """All types for the inventory form; with `q`, a short search for the intake
    form (there are more types than a dropdown can sensibly hold). `display`
    carries the manufacturer, which the bare model name often omits."""
    params: dict[str, Any] = {"limit": 25 if q else 1000}
    if q:
        params["q"] = q
    results = (await _request("GET", DEVICE_TYPES_PATH, params=params)).json().get("results", [])
    return [
        NetboxLookupItem(
            id=t["id"], name=t.get("model") or t.get("display") or str(t["id"]), slug=t.get("slug"),
            display=" ".join(filter(None, [(t.get("manufacturer") or {}).get("name"), t.get("model")])) or None,
        )
        for t in results
    ]


async def list_sites() -> list[NetboxLookupItem]:
    return await _list_lookup(SITES_PATH)


async def list_device_roles() -> list[NetboxLookupItem]:
    return await _list_lookup(DEVICE_ROLES_PATH)


async def list_manufacturers() -> list[NetboxLookupItem]:
    return await _list_lookup(MANUFACTURERS_PATH, limit=1000)


async def list_device_assignments(device_id: int) -> list[dict]:
    """Who holds this device, with the signed handover attached."""
    response = await _request("GET", ASSIGNMENTS_PATH, params={
        "object_type": "dcim.device", "object_id": device_id, "limit": 50,
    })
    return [_to_assignment(a) for a in response.json().get("results", [])]


async def list_contacts(q: Optional[str] = None, page: int = 1, page_size: int = 25) -> dict:
    params: dict[str, Any] = {"limit": page_size, "offset": (page - 1) * page_size}
    if q:
        params["q"] = q
    data = (await _request("GET", CONTACTS_PATH, params=params)).json()
    return {
        "items": [_to_contact(c) for c in data.get("results", [])],
        "total": data.get("count", 0),
        "page": page,
        "page_size": page_size,
    }


async def get_contact(contact_id: int) -> dict:
    return _to_contact((await _request("GET", f"{CONTACTS_PATH}{contact_id}/")).json())


async def list_contact_assets(contact_id: int) -> list[dict]:
    """Everything a person holds — the offboarding question, answered."""
    response = await _request("GET", ASSIGNMENTS_PATH, params={
        "contact_id": contact_id, "limit": 100,
    })
    return [_to_assignment(a) for a in response.json().get("results", [])]


async def list_tenants() -> list[NetboxLookupItem]:
    return await _list_lookup(TENANTS_PATH)


async def list_locations() -> list[NetboxLookupItem]:
    return await _list_lookup(LOCATIONS_PATH, limit=1000)


async def _supplier_choice_set() -> Optional[dict]:
    data = (await _request("GET", CHOICE_SETS_PATH, params={"name": SUPPLIER_CHOICE_SET, "limit": 5})).json()
    for cs in data.get("results", []):
        if cs.get("name") == SUPPLIER_CHOICE_SET:
            return cs
    return None


async def list_suppliers() -> list[str]:
    """`supplier` is a required device field backed by a NetBox choice set, so
    the create form has to offer exactly these values or every save fails."""
    cs = await _supplier_choice_set()
    if not cs:
        return []
    return [c[0] if isinstance(c, (list, tuple)) else c for c in (cs.get("extra_choices") or [])]


async def ensure_supplier(name: str) -> str:
    """The supplier value to write on a device. An existing choice is matched
    case-insensitively (the set mixes 'IKEA' and 'sharafdg'); a new one is
    appended to the choice set, since NetBox rejects any value outside it."""
    name = " ".join(name.split())
    cs = await _supplier_choice_set()
    if not cs:
        raise NetboxError("NetBox has no 'suppliers' choice set", status_code=409)
    choices = [list(c) if isinstance(c, (list, tuple)) else [c, c] for c in (cs.get("extra_choices") or [])]
    for value, label in choices:
        if name.casefold() in (str(value).casefold(), str(label).casefold()):
            return value
    await _request("PATCH", f"{CHOICE_SETS_PATH}{cs['id']}/", json={"extra_choices": choices + [[name, name]]})
    logger.info("[netbox] supplier '%s' added to the choice set", name)
    return name


# ─── Intake writes ────────────────────────────────────────────────────


def slugify(text: str, max_len: int = 100) -> str:
    out = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return (out or "item")[:max_len].strip("-")


async def ensure_manufacturer(name: str) -> int:
    name = " ".join(name.split())
    for found in (await _request("GET", MANUFACTURERS_PATH, params={"name__ie": name})).json().get("results", []):
        return found["id"]
    slug = slugify(name, 50)
    if (await _request("GET", MANUFACTURERS_PATH, params={"slug": slug})).json().get("count"):
        slug = f"{slug[:44]}-{uuid.uuid4().hex[:5]}"
    created = (await _request("POST", MANUFACTURERS_PATH, json={"name": name, "slug": slug})).json()
    logger.info("[netbox] manufacturer '%s' created (#%s)", name, created["id"])
    return created["id"]


async def ensure_device_type(manufacturer: str, model: str) -> NetboxLookupItem:
    """Reuse a type with this exact model under this manufacturer, else create
    it. Slugs are unique per manufacturer, so a clash gets a short suffix."""
    model = " ".join(model.split())
    manufacturer_id = await ensure_manufacturer(manufacturer)
    existing = (await _request("GET", DEVICE_TYPES_PATH, params={
        "manufacturer_id": manufacturer_id, "model__ie": model,
    })).json().get("results", [])
    if existing:
        t = existing[0]
        return NetboxLookupItem(id=t["id"], name=t["model"], slug=t.get("slug"), display=t.get("display"))
    slug = slugify(model)
    if (await _request("GET", DEVICE_TYPES_PATH, params={
        "manufacturer_id": manufacturer_id, "slug": slug,
    })).json().get("count"):
        slug = f"{slug[:94]}-{uuid.uuid4().hex[:5]}"
    t = (await _request("POST", DEVICE_TYPES_PATH, json={
        "manufacturer": manufacturer_id, "model": model, "slug": slug, "u_height": 0,
    })).json()
    logger.info("[netbox] device type '%s' created (#%s)", model, t["id"])
    return NetboxLookupItem(id=t["id"], name=t["model"], slug=t.get("slug"), display=t.get("display"))


async def find_device_by_serial(serial: str) -> Optional[dict]:
    results = (await _request("GET", DEVICES_PATH, params={"serial": serial, "limit": 2})).json().get("results", [])
    return results[0] if results else None


async def create_device_raw(body: dict) -> NetboxDeviceDetail:
    """Device create with custom fields and tenant — the intake path. The
    regular `create_device` keeps its narrow schema for the inventory form."""
    response = await _request("POST", DEVICES_PATH, json=body)
    return NetboxDeviceDetail.model_validate(_to_detail(response.json()))


async def wait_for_asset_tags(device_ids: list[int], timeout: float = 20.0) -> dict[int, Optional[str]]:
    """Asset tags are not ours to pick: a webhook receiver on the NetBox host
    numbers each new device from its tenant's `asset_tag_start`. It runs
    asynchronously, so poll briefly; whatever has not arrived stays None and
    the UI says it will appear in NetBox shortly."""
    tags: dict[int, Optional[str]] = {i: None for i in device_ids}
    deadline = time.monotonic() + timeout
    while True:
        missing = [i for i, tag in tags.items() if not tag]
        if not missing:
            break
        params = {"id": missing, "limit": len(missing)}
        for d in (await _request("GET", DEVICES_PATH, params=params)).json().get("results", []):
            tags[d["id"]] = d.get("asset_tag") or None
        if all(tags.values()) or time.monotonic() >= deadline:
            break
        await asyncio.sleep(1.5)
    return tags


# ─── Handover writes ──────────────────────────────────────────────────
#
# NetBox already models a handover and the portal follows that model exactly:
#   1. upload the document as an attachment
#   2. bind the attachment to the device
#   3. create a contact-assignment (contact, role "Handover") carrying
#      signed_by, status and handover_attachment
# Device status is deliberately untouched — NetBox has no "assigned" status,
# and possession is expressed by the assignment.


async def _handover_role_id() -> Optional[int]:
    response = await _request("GET", CONTACT_ROLES_PATH, params={"slug": HANDOVER_ROLE_SLUG})
    results = response.json().get("results", [])
    return results[0]["id"] if results else None


async def upload_attachment(filename: str, content: bytes, display_name: str,
                            content_type: str) -> dict:
    """Store a file in NetBox's attachment plugin. Not yet bound to anything."""
    base_url, headers = _client_kwargs()
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                f"{base_url}{ATTACHMENTS_PATH}",
                headers=headers,
                data={"name": display_name[:100]},
                files={"file": (filename, content, content_type)},
            )
            response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text[:300]
        logger.warning("[netbox] attachment upload -> %s: %s", exc.response.status_code, detail)
        raise NetboxError(f"NetBox rejected the attachment: {detail}",
                          status_code=exc.response.status_code) from exc
    except httpx.HTTPError as exc:
        raise NetboxError("Cannot reach NetBox", status_code=502) from exc
    return response.json()


async def bind_attachment(attachment_id: int, object_id: int,
                          object_type: str = DEVICE_OBJECT_TYPE) -> dict:
    response = await _request("POST", ATTACHMENT_ASSIGN_PATH, json={
        "attachment": attachment_id,
        "object_type": object_type,
        "object_id": object_id,
    })
    return response.json()


async def create_handover_assignment(*, device_id: int, contact_id: int, signed_by_id: int,
                                     attachment_id: int, status: str = "active") -> dict:
    role_id = await _handover_role_id()
    body: dict[str, Any] = {
        "object_type": DEVICE_OBJECT_TYPE,
        "object_id": device_id,
        "contact": contact_id,
        "custom_fields": {
            "signed_by": signed_by_id,
            "status": status,
            "handover_attachment": attachment_id,
        },
    }
    if role_id:
        body["role"] = role_id
    response = await _request("POST", ASSIGNMENTS_PATH, json=body)
    return _to_assignment(response.json())


async def set_assignment_document(assignment_id: int, attachment_id: int) -> dict:
    """Point a handover at a different document — the signed scan replacing the draft."""
    response = await _request("PATCH", f"{ASSIGNMENTS_PATH}{assignment_id}/", json={
        "custom_fields": {"handover_attachment": attachment_id},
    })
    return _to_assignment(response.json())


async def active_assignment_for(device_id: int) -> Optional[dict]:
    """An active holder blocks a second handover — the device is already out."""
    for assignment in await list_device_assignments(device_id):
        if (assignment.get("status") or "").lower() == "active":
            return assignment
    return None
