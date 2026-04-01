"""Schedule endpoints — shifts, auto-gen, time-off."""
from uuid import UUID
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload
from datetime import date
from app.core.database import get_db
from app.core.deps import get_current_user, require_admin
from app.core.scheduler import scheduler
from app.workers.shift_notification_scheduler import schedule_pending_notifications
from app.models.models import User, Shift, TimeOffRequest, ShiftType, ShiftConfig, UserRole
from app.schemas.schemas import (
    ShiftCreate, ShiftUpdate, ShiftResponse, ScheduleGenerateRequest,
    TimeOffCreate, TimeOffResponse, TimeOffReviewRequest,
    ShiftConfigResponse,
)
from app.services.schedule_service import generate_schedule
from app.services.audit import log_action

router = APIRouter(prefix="/schedule", tags=["schedule"])


# ─── Public: shift configs for frontend rendering ───────

@router.get("/shift-configs", response_model=list[ShiftConfigResponse])
async def get_shift_configs(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(ShiftConfig).where(ShiftConfig.is_active == True)
    )
    return [ShiftConfigResponse.model_validate(c) for c in result.scalars().all()]


# ─── Shifts ──────────────────────────────────────────────

@router.get("/shifts", response_model=list[ShiftResponse])
async def list_shifts(
    start_date: date = Query(...),
    end_date: date = Query(...),
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if (end_date - start_date).days > 366:
        raise HTTPException(status_code=400, detail="Date range too large (max 366 days)")
    if end_date < start_date:
        raise HTTPException(status_code=400, detail="end_date must be >= start_date")

    filters = [Shift.date >= start_date, Shift.date <= end_date]
    if user.role != UserRole.ADMIN:
        # Engineers only see published shifts
        filters.append(Shift.is_published == True)

    result = await db.execute(
        select(Shift)
        .options(selectinload(Shift.user))
        .where(and_(*filters))
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
    # Auto-fill times from config
    if not shift.start_time or not shift.end_time:
        cfg = await db.execute(
            select(ShiftConfig).where(ShiftConfig.shift_type == req.shift_type)
        )
        config = cfg.scalar_one_or_none()
        if config:
            if not shift.start_time:
                shift.start_time = config.default_start_time
            if not shift.end_time:
                shift.end_time = config.default_end_time
    db.add(shift)
    await db.flush()
    await db.refresh(shift, ["user"])
    return ShiftResponse.model_validate(shift)


@router.delete("/shifts/drafts")
async def clear_draft_shifts(
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
    drafts = result.scalars().all()
    for s in drafts:
        await db.delete(s)
    await log_action(db, admin, "drafts_cleared", f"{len(drafts)} drafts from {start_date} to {end_date}")
    return {"deleted": len(drafts)}


@router.patch("/shifts/{shift_id}", response_model=ShiftResponse)
async def update_shift(
    shift_id: UUID,
    req: ShiftUpdate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Shift).options(selectinload(Shift.user)).where(Shift.id == shift_id)
    )
    shift = result.scalar_one_or_none()
    if not shift:
        raise HTTPException(status_code=404)
    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(shift, field, value)
    await db.flush()
    await db.refresh(shift, ["user"])
    return ShiftResponse.model_validate(shift)


@router.delete("/shifts/{shift_id}")
async def delete_shift(
    shift_id: UUID,
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
    assignments = await generate_schedule(
        db, req.start_date, req.end_date, req.shift_types, req.user_ids or None
    )

    shifts = []
    for a in assignments:
        shift = Shift(
            user_id=a["user_id"],
            date=a["date"],
            shift_type=a["shift_type"],
            start_time=a.get("start_time"),
            end_time=a.get("end_time"),
            is_published=False,
        )
        db.add(shift)
        shifts.append(shift)

    await db.flush()
    for s in shifts:
        await db.refresh(s, ["user"])

    await log_action(db, admin, "schedule_generated",
        f"{len(shifts)} shifts from {req.start_date} to {req.end_date}")
    return [ShiftResponse.model_validate(s) for s in shifts]


@router.post("/publish")
async def publish_schedule(
    background_tasks: BackgroundTasks,
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
    await log_action(db, admin, "schedule_published",
        f"{len(shifts)} shifts from {start_date} to {end_date}")
    # Schedule notifications after commit (BackgroundTasks run post-response)
    background_tasks.add_task(schedule_pending_notifications, scheduler)
    return {"published": len(shifts)}


# ─── Time Off ────────────────────────────────────────────

@router.get("/time-off", response_model=list[TimeOffResponse])
async def list_time_off(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    query = select(TimeOffRequest).options(selectinload(TimeOffRequest.user))
    if user.role != UserRole.ADMIN:
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
    await log_action(db, user, "time_off_requested",
        f"{req.off_type.value} from {req.start_date} to {req.end_date}")
    return TimeOffResponse.model_validate(time_off)


@router.patch("/time-off/{request_id}", response_model=TimeOffResponse)
async def review_time_off(
    request_id: UUID,
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
    await log_action(db, admin, "time_off_reviewed",
        f"Request {request_id} → {req.status.value}" + (f" | {req.admin_comment}" if req.admin_comment else ""))
    return TimeOffResponse.model_validate(time_off)


@router.delete("/time-off/{request_id}")
async def delete_time_off(
    request_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(TimeOffRequest).where(TimeOffRequest.id == request_id))
    time_off = result.scalar_one_or_none()
    if not time_off:
        raise HTTPException(status_code=404)
    if user.role != UserRole.ADMIN and time_off.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not allowed")
    await db.delete(time_off)
    return {"deleted": True}
