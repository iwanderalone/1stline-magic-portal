"""Office map: devices and holders are bucketed by their own NetBox location."""
import asyncio

import httpx

from app.services import netbox_service as nbs
from app.services import office_map_service as oms


def _dev(i, loc, role="Monitor"):
    return {"id": i, "name": f"dev-{i}", "role": {"name": role}, "location": {"id": loc},
            "device_type": {"model": "M", "manufacturer": {"name": "Dell"}}, "status": {"value": "active"}}


def test_occupancy_groups_by_exact_location_and_active_holders(monkeypatch):
    calls = []

    async def fake(method, path, **kw):
        calls.append(path)
        if path == nbs.DEVICES_PATH:
            # NetBox's location_id also matches children; dev-3 sits in a child we don't map
            return httpx.Response(200, json={"results": [_dev(1, 10), _dev(2, 10, "Laptop"), _dev(3, 99)],
                                             "next": None})
        if path == nbs.ASSIGNMENTS_PATH:
            return httpx.Response(200, json={"results": [
                {"object": {"id": 2}, "contact": {"name": "Ivan Petrov"}, "custom_fields": {"status": "active"}},
                {"object": {"id": 1}, "contact": {"name": "Ivan Petrov"}, "custom_fields": {"status": "active"}},
                {"object": {"id": 1}, "contact": {"name": "Old Owner"}, "custom_fields": {"status": "returned"}},
                {"object": {"id": 1}, "contact": {"name": "[Disabled] Gone"}, "custom_fields": {}},
            ]})
        raise AssertionError(path)

    monkeypatch.setattr(nbs, "_request", fake)
    oms.forget_occupancy()
    out = asyncio.run(oms.occupancy([10, 11]))

    assert [d["id"] for d in out[10]["devices"]] == [2, 1]          # sorted by role: Laptop, Monitor
    assert out[10]["people"] == ["Ivan Petrov"]                     # deduped; returned + leavers dropped
    assert out[11] == {"devices": [], "people": []}
    assert 99 not in out

    asyncio.run(oms.occupancy([11, 10]))                             # same set → served from cache
    assert calls.count(nbs.DEVICES_PATH) == 1
