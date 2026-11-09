"""Office map (Inventory → Map): floor plans whose desks, rooms and racks are
NetBox locations.

The split of truth: geometry (walls, where a desk is drawn) is the portal's —
NetBox has no coordinates. What is *at* a desk is NetBox's — a device's
`location` — and is read live, so the map can never disagree with inventory.
Who sits at a desk is derived: the holders (contact assignments) of the
devices at that location.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.models import OfficeMapArea, OfficeMapItem
from app.services import netbox_service as nbs

logger = logging.getLogger(__name__)

RACKS_PATH = "/api/dcim/racks/"
KINDS = {"desk", "room", "rack"}
OCCUPANCY_TTL = 30          # seconds — a map refresh shouldn't cost NetBox a full device sweep each time
_occupancy_cache: dict[str, Any] = {"at": 0.0, "key": None, "data": None}


# ─── read ────────────────────────────────────────────────────────────

def _item_out(i: OfficeMapItem) -> dict:
    return {
        "id": i.id, "kind": i.kind, "label": i.label, "zone": i.zone,
        "location_id": i.netbox_location_id, "rack_id": i.netbox_rack_id,
        "x": i.x, "y": i.y, "w": i.w, "h": i.h, "note": i.note,
    }


async def get_map(db: AsyncSession) -> list[dict]:
    areas = (await db.execute(
        select(OfficeMapArea).options(selectinload(OfficeMapArea.items)).order_by(OfficeMapArea.sort, OfficeMapArea.id)
    )).scalars().all()
    return [{
        "id": a.id, "slug": a.slug, "name": a.name, "width": a.width, "height": a.height,
        "walls": json.loads(a.walls or "[]"),
        "labels": json.loads(a.labels or "[]"),
        "zones": json.loads(a.zones or "[]"),
        "items": [_item_out(i) for i in sorted(a.items, key=lambda i: i.id)],
    } for a in areas]


def _device_out(raw: dict) -> dict:
    return {
        "id": raw["id"],
        "name": raw.get("name") or raw.get("display"),
        "role": (raw.get("role") or {}).get("name"),
        "type": ((raw.get("device_type") or {}).get("model")),
        "manufacturer": (((raw.get("device_type") or {}).get("manufacturer") or {}).get("name")),
        "asset_tag": raw.get("asset_tag"),
        "serial": raw.get("serial"),
        "status": (raw.get("status") or {}).get("value"),
    }


async def occupancy(location_ids: list[int]) -> dict[int, dict]:
    """Devices and their holders per location, for every bound map item at once."""
    ids = sorted(set(location_ids))
    key = ",".join(map(str, ids))
    now = time.monotonic()
    if _occupancy_cache["key"] == key and now - _occupancy_cache["at"] < OCCUPANCY_TTL:
        return _occupancy_cache["data"]

    by_loc: dict[int, dict] = {i: {"devices": [], "people": []} for i in ids}
    devices: list[dict] = []
    # location_id in NetBox also matches child locations; we want exact
    # placement, so the device's own location decides the bucket below.
    for start in range(0, len(ids), 100):
        chunk = ids[start:start + 100]
        offset = 0
        while True:
            r = await nbs._request("GET", nbs.DEVICES_PATH, params=[("location_id", c) for c in chunk]
                                   + [("limit", 1000), ("offset", offset)])
            data = r.json()
            devices += data.get("results", [])
            offset += len(data.get("results", []))
            if not data.get("next"):
                break

    holders: dict[int, list[str]] = {}
    dev_ids = sorted({d["id"] for d in devices})
    for start in range(0, len(dev_ids), 100):
        chunk = dev_ids[start:start + 100]
        r = await nbs._request("GET", nbs.ASSIGNMENTS_PATH, params=[("object_type", nbs.DEVICE_OBJECT_TYPE)]
                               + [("object_id", c) for c in chunk] + [("limit", 1000)])
        for a in r.json().get("results", []):
            status = ((a.get("custom_fields") or {}).get("status") or "").lower()
            contact = a.get("contact") or {}
            if status and status != "active":
                continue
            name = contact.get("name") or contact.get("display")
            if name and not name.lower().startswith("[disabled]"):
                holders.setdefault((a.get("object") or {}).get("id") or a.get("object_id"), []).append(name)

    for raw in devices:
        loc = (raw.get("location") or {}).get("id")
        if loc not in by_loc:
            continue
        d = _device_out(raw)
        d["holders"] = holders.get(raw["id"], [])
        by_loc[loc]["devices"].append(d)
    for bucket in by_loc.values():
        bucket["devices"].sort(key=lambda d: ((d["role"] or "~"), d["name"] or ""))
        people: list[str] = []
        for d in bucket["devices"]:
            for p in d["holders"]:
                if p not in people:
                    people.append(p)
        bucket["people"] = people

    _occupancy_cache.update({"at": now, "key": key, "data": by_loc})
    return by_loc


def forget_occupancy() -> None:
    _occupancy_cache.update({"at": 0.0, "key": None, "data": None})


async def rack_elevation_svg(rack_id: int, face: str) -> bytes:
    r = await nbs._request("GET", f"{RACKS_PATH}{rack_id}/elevation/",
                           params={"face": face, "render": "svg"})
    return r.content


# ─── write ───────────────────────────────────────────────────────────

async def update_item(db: AsyncSession, item: OfficeMapItem, fields: dict) -> dict:
    for k in ("x", "y", "w", "h", "label", "note", "zone"):
        if k in fields and fields[k] is not None:
            setattr(item, k, fields[k])
    if "location_id" in fields:
        item.netbox_location_id = fields["location_id"]
    await db.commit()
    await db.refresh(item)
    return _item_out(item)


async def import_map(db: AsyncSession, data: dict) -> dict:
    """Replace the plans named in `data` (by slug) with what it describes.

    Items are bound to NetBox by name: a desk/room labelled `desk-07` binds to
    the location `desk-07`; a rack binds to the location *and* to the NetBox
    rack standing in it. Anything without a match is kept unbound and reported.
    """
    locs = (await nbs._request("GET", nbs.LOCATIONS_PATH, params={"limit": 1000})).json()["results"]
    loc_by_name = {l["name"].lower(): l["id"] for l in locs}
    racks = (await nbs._request("GET", RACKS_PATH, params={"limit": 1000})).json()["results"]
    rack_by_loc = {(r.get("location") or {}).get("id"): r["id"] for r in racks if r.get("location")}

    report: dict[str, Any] = {"areas": [], "unbound": []}
    for sort, a in enumerate(data.get("areas", [])):
        area = (await db.execute(select(OfficeMapArea).where(OfficeMapArea.slug == a["slug"]))).scalar_one_or_none()
        if area is None:
            area = OfficeMapArea(slug=a["slug"])
            db.add(area)
        area.name, area.sort = a["name"], sort
        area.width, area.height = int(a["width"]), int(a["height"])
        area.walls = json.dumps(a.get("walls", []))
        area.labels = json.dumps(a.get("labels", []))
        area.zones = json.dumps(a.get("zones", []))
        await db.flush()
        for old in (await db.execute(select(OfficeMapItem).where(OfficeMapItem.area_id == area.id))).scalars():
            await db.delete(old)
        await db.flush()

        bound = 0
        for o in a.get("objects", []):
            kind = o.get("kind")
            if kind not in KINDS:
                continue
            name = o.get("name")
            loc_id = loc_by_name.get(name.lower()) if name else None
            if loc_id:
                bound += 1
            else:
                report["unbound"].append(name or o.get("note") or f"{kind} at {o['x']},{o['y']}")
            db.add(OfficeMapItem(
                area_id=area.id, kind=kind, label=name, note=o.get("note"), zone=o.get("zone"),
                netbox_location_id=loc_id, netbox_rack_id=rack_by_loc.get(loc_id) if kind == "rack" else None,
                x=o["x"], y=o["y"], w=o["w"], h=o["h"],
            ))
        report["areas"].append({"slug": a["slug"], "items": len(a.get("objects", [])), "bound": bound})
    await db.commit()
    forget_occupancy()
    return report
