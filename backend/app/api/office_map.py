"""Inventory → Map: office floor plans bound to NetBox locations."""
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user, get_or_404, require_admin, require_admin_or_manager
from app.models.models import OfficeMapItem, User
from app.services import netbox_service as nbs
from app.services import office_map_service as oms
from app.services.audit import log_action

router = APIRouter(prefix="/tools/office-map", tags=["office-map"])


class MapItemPatch(BaseModel):
    x: Optional[float] = None
    y: Optional[float] = None
    w: Optional[float] = Field(None, gt=0)
    h: Optional[float] = Field(None, gt=0)
    label: Optional[str] = Field(None, max_length=100)
    note: Optional[str] = Field(None, max_length=300)
    zone: Optional[str] = Field(None, max_length=100)


def _netbox_error(exc: nbs.NetboxError) -> HTTPException:
    return HTTPException(status_code=exc.status_code, detail=str(exc))


@router.get("")
async def get_map(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    from app.core.config import get_settings
    return {"areas": await oms.get_map(db), "netbox": nbs.enabled(),
            "netbox_url": get_settings().NETBOX_URL.rstrip("/") or None}


@router.get("/occupancy")
async def get_occupancy(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    if not nbs.enabled():
        return {}
    ids = [i["location_id"] for a in await oms.get_map(db) for i in a["items"] if i["location_id"]]
    try:
        data = await oms.occupancy(ids)
    except nbs.NetboxError as exc:
        raise _netbox_error(exc) from exc
    return {str(k): v for k, v in data.items()}


@router.get("/racks/{rack_id}/elevation.svg")
async def rack_elevation(rack_id: int, face: Literal["front", "rear"] = "front",
                         _: User = Depends(get_current_user)):
    try:
        svg = await oms.rack_elevation_svg(rack_id, face)
    except nbs.NetboxError as exc:
        raise _netbox_error(exc) from exc
    # Served as an image, never inlined: the SVG links back into NetBox and
    # must not run in the portal's origin.
    return Response(content=svg, media_type="image/svg+xml",
                    headers={"Cache-Control": "private, max-age=60",
                             "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'"})


@router.patch("/items/{item_id}")
async def patch_item(item_id: int, body: MapItemPatch, db: AsyncSession = Depends(get_db),
                     user: User = Depends(require_admin_or_manager)):
    item = await get_or_404(db, OfficeMapItem, item_id)
    return await oms.update_item(db, item, body.model_dump(exclude_unset=True))


@router.post("/import")
async def import_map(data: dict, db: AsyncSession = Depends(get_db), admin: User = Depends(require_admin)):
    """Replace plans from a JSON export (see office_map_service.import_map)."""
    if not isinstance(data.get("areas"), list) or not data["areas"]:
        raise HTTPException(status_code=422, detail="expected {areas: [...]}")
    try:
        report = await oms.import_map(db, data)
    except nbs.NetboxError as exc:
        raise _netbox_error(exc) from exc
    await log_action(db, admin, "office_map_import", json_summary(report))
    await db.commit()
    return report


def json_summary(report: dict) -> str:
    parts = [f"{a['slug']}: {a['bound']}/{a['items']} bound" for a in report["areas"]]
    return "; ".join(parts) + (f"; unbound: {', '.join(map(str, report['unbound']))}" if report["unbound"] else "")
