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
    return {
        **_to_summary(raw),
        "manufacturer": _ref((raw.get("device_type") or {}).get("manufacturer")),
        "platform": _ref(raw.get("platform")),
        "location": _ref(raw.get("location")),
        "rack": _ref(raw.get("rack")),
        "comments": raw.get("comments"),
        "custom_fields": raw.get("custom_fields"),
        "last_updated": raw.get("last_updated"),
    }


async def list_devices(
    q: Optional[str] = None,
    site: Optional[int] = None,
    role: Optional[int] = None,
    status: Optional[str] = None,
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
