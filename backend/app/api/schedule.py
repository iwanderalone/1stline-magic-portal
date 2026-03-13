"""Schedule endpoints — shifts, auto-gen, time-off."""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, delete
from sqlalchemy.orm import selectinload
from datetime import date
from app.core.database import get_db
from app.core.deps import get_current_user, require_admin
from app.models.models import User, Shift, TimeOffRequest, ShiftType
from app.schemas.schemas import (
    ShiftCreate, ShiftResponse, ScheduleGenerateRequest,
    TimeOffCreate, TimeOffResponse, TimeOffReviewRequest, UserResponse,
)
from app.services.schedule_service import generate_schedule

router = APIRouter(prefix="/schedule", tags=["schedule"])


# ─── Shifts ──────────────────────────────────────────────

@router.get("/shifts", response_model=list[ShiftResponse])
async def list_shifts(
    start_date: date = Query(...),
    end_date: date = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Shift)
        .options(selectinload(Shift.user))
        .where(and_(Shift.date >= start_date, Shift.date <= end_date))
        .order_by(Shift.date, Shift.shift_type)
    )
    return [ShiftResponse.model_validate(s) for s in result.scalars().all()]


@router.post("/shifts", response_model=ShiftResponse)
async def create_shift(
    req: ShiftCreate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    shift = Shift(**req.model_dump())
    db.add(shift)
    await db.flush()
    await db.refresh(shift, ["user"])
    return ShiftResponse.model_validate(shift)


@router.delete("/shifts/{shift_id}")
async def delete_shift(
    shift_id: str,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Shift).where(Shift.id == shift_id))
    shift = result.scalar_one_or_none()
    if not shift:
        raise HTTPException(status_code=404)
    await db.delete(shift)
    return {"deleted": True}


@router.post("/generate", response_model=list[ShiftResponse])
async def auto_generate(
    req: ScheduleGenerateRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Generate schedule with constraints. Does NOT delete existing shifts."""
    user_ids = [str(uid) for uid in req.user_ids] if req.user_ids else None
    assignments = await generate_schedule(
        db, req.start_date, req.end_date, req.shift_types, user_ids
    )

    shifts = []
    for a in assignments:
        shift = Shift(
            user_id=a["user_id"],
            date=a["date"],
            shift_type=a["shift_type"],
            is_published=False,
        )
        db.add(shift)
        shifts.append(shift)

    await db.flush()
    for s in shifts:
        await db.refresh(s, ["user"])

    return [ShiftResponse.model_validate(s) for s in shifts]


@router.post("/publish")
async def publish_schedule(
    start_date: date = Query(...),
    end_date: date = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Shift).where(
            and_(Shift.date >= start_date, Shift.date <= end_date, Shift.is_published == False)
        )
    )
    shifts = result.scalars().all()
    for s in shifts:
        s.is_published = True
    await db.flush()
    return {"published": len(shifts)}


# ─── Time Off ────────────────────────────────────────────

@router.get("/time-off", response_model=list[TimeOffResponse])
async def list_time_off(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(TimeOffRequest).options(selectinload(TimeOffRequest.user))
    if user.role != "admin":
        query = query.where(TimeOffRequest.user_id == user.id)
    query = query.order_by(TimeOffRequest.created_at.desc())
    result = await db.execute(query)
    return [TimeOffResponse.model_validate(r) for r in result.scalars().all()]


@router.post("/time-off", response_model=TimeOffResponse)
async def request_time_off(
    req: TimeOffCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if req.end_date < req.start_date:
        raise HTTPException(status_code=400, detail="End date must be after start date")

    time_off = TimeOffRequest(user_id=user.id, **req.model_dump())
    db.add(time_off)
    await db.flush()
    await db.refresh(time_off, ["user"])
    return TimeOffResponse.model_validate(time_off)


@router.patch("/time-off/{request_id}", response_model=TimeOffResponse)
async def review_time_off(
    request_id: str,
    req: TimeOffReviewRequest,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TimeOffRequest).options(selectinload(TimeOffRequest.user))
        .where(TimeOffRequest.id == request_id)
    )
    time_off = result.scalar_one_or_none()
    if not time_off:
        raise HTTPException(status_code=404)

    time_off.status = req.status
    if req.admin_comment:
        time_off.admin_comment = req.admin_comment
    await db.flush()
    await db.refresh(time_off)
    return TimeOffResponse.model_validate(time_off)
