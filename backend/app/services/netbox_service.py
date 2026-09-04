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
import logging
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
CHOICE_SETS_PATH = "/api/extras/custom-field-choice-sets/"

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
    }


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


async def _list_lookup(path: str) -> list[NetboxLookupItem]:
    response = await _request("GET", path, params={"limit": 250})
    return [
        NetboxLookupItem(id=item["id"], name=item.get("name") or item.get("display") or str(item["id"]), slug=item.get("slug"))
        for item in response.json().get("results", [])
    ]


async def list_device_types() -> list[NetboxLookupItem]:
    return await _list_lookup(DEVICE_TYPES_PATH)


async def list_sites() -> list[NetboxLookupItem]:
    return await _list_lookup(SITES_PATH)


async def list_device_roles() -> list[NetboxLookupItem]:
    return await _list_lookup(DEVICE_ROLES_PATH)


async def list_manufacturers() -> list[NetboxLookupItem]:
    return await _list_lookup(MANUFACTURERS_PATH)


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


async def list_suppliers() -> list[str]:
    """`supplier` is a required device field backed by a NetBox choice set, so
    the create form has to offer exactly these values or every save fails."""
    data = (await _request("GET", CHOICE_SETS_PATH, params={"limit": 50})).json()
    for cs in data.get("results", []):
        if cs.get("name") == "suppliers":
            return [c[0] if isinstance(c, (list, tuple)) else c for c in (cs.get("extra_choices") or [])]
    return []
