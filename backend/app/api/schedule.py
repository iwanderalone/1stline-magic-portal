"""Schedule endpoints — shifts, auto-gen, time-off."""
from uuid import UUID
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from sqlalchemy.orm import selectinload
from datetime import date
from collections import defaultdict
from app.core.database import get_db
from app.core.deps import get_current_user, require_admin, get_or_404
from app.core.scheduler import scheduler
from app.workers.shift_notification_scheduler import schedule_pending_notifications
from app.models.models import User, Shift, TimeOffRequest, UserBlockedDate, ShiftType, ShiftConfig, UserRole
from app.schemas.schemas import (
    ShiftCreate, ShiftUpdate, ShiftResponse, ScheduleGenerateRequest,
    TimeOffCreate, TimeOffResponse, TimeOffReviewRequest,
    ShiftConfigResponse, UserBlockedDateCreate, UserBlockedDateResponse,
)
from app.services.schedule_service import generate_schedule, validate_shift_assignment
from app.services.audit import log_action
from app.services.telegram_service import notify_schedule_published

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
        filters.append(Shift.is_published == True)
        filters.append(Shift.pending_delete == False)

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
    await validate_shift_assignment(db, req.user_id, req.date, req.shift_type)
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
    await log_action(db, admin, "shift_created",
        f"{shift.user.display_name} — {shift.shift_type.value} on {shift.date}")
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
    shift = await get_or_404(db, Shift, shift_id)
    await db.refresh(shift, ["user"])
    if req.shift_type is not None and req.shift_type != shift.shift_type:
        await validate_shift_assignment(db, shift.user_id, shift.date, req.shift_type, exclude_shift_id=shift.id)
    changes = []
    for field, value in req.model_dump(exclude_unset=True).items():
        old = getattr(shift, field)
        if old != value:
            old_str = old.value if hasattr(old, "value") else str(old)
            new_str = value.value if hasattr(value, "value") else str(value)
            changes.append(f"{field}: {old_str} → {new_str}")
        setattr(shift, field, value)
    await db.flush()
    await db.refresh(shift, ["user"])
    if changes:
        await log_action(db, admin, "shift_updated",
            f"{shift.user.display_name} on {shift.date}: {', '.join(changes)}")
    return ShiftResponse.model_validate(shift)


@router.delete("/shifts/{shift_id}")
async def delete_shift(
    shift_id: UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    shift = await get_or_404(db, Shift, shift_id)
    await db.refresh(shift, ["user"])
    if not shift.is_published:
        # Draft never published — hard delete immediately, no need to stage
        await log_action(db, admin, "shift_deleted",
            f"{shift.user.display_name} — {shift.shift_type.value} on {shift.date} (draft discarded)")
        await db.delete(shift)
    else:
        shift.pending_delete = True
        await log_action(db, admin, "shift_staged_for_removal",
            f"{shift.user.display_name} — {shift.shift_type.value} on {shift.date} (will be removed on next publish)")
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

    counts: dict = defaultdict(int)
    for s in shifts:
        if s.user:
            counts[s.user.display_name] += 1
    breakdown = ", ".join(f"{name}×{n}" for name, n in sorted(counts.items()))
    await log_action(db, admin, "schedule_generated",
        f"{len(shifts)} shifts from {req.start_date} to {req.end_date}" + (f" | {breakdown}" if breakdown else ""))
    return [ShiftResponse.model_validate(s) for s in shifts]


@router.post("/publish")
async def publish_schedule(
    background_tasks: BackgroundTasks,
    start_date: date = Query(...),
    end_date: date = Query(...),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    # Shifts to publish (new drafts)
    added_result = await db.execute(
        select(Shift)
        .options(selectinload(Shift.user))
        .where(and_(Shift.date >= start_date, Shift.date <= end_date,
                    Shift.is_published == False, Shift.pending_delete == False))
    )
    added = added_result.scalars().all()
    for s in added:
        s.is_published = True

    # Shifts staged for removal
    removed_result = await db.execute(
        select(Shift)
        .options(selectinload(Shift.user))
        .where(and_(Shift.date >= start_date, Shift.date <= end_date, Shift.pending_delete == True))
    )
    removed = removed_result.scalars().all()
    for s in removed:
        await db.delete(s)

    await db.flush()

    added_lines = sorted([f"{s.date} {s.shift_type.value} — {s.user.display_name}" for s in added if s.user])
    removed_lines = sorted([f"{s.date} {s.shift_type.value} — {s.user.display_name}" for s in removed if s.user])
    detail_parts = [f"{len(added)} added, {len(removed)} removed ({start_date} to {end_date})"]
    if added_lines:
        detail_parts.append("Added:\n" + "\n".join(added_lines))
    if removed_lines:
        detail_parts.append("Removed:\n" + "\n".join(removed_lines))
    await log_action(db, admin, "schedule_published", "\n".join(detail_parts))

    added_data = [
        {"date": s.date, "shift_type": s.shift_type, "display_name": s.user.display_name if s.user else "?", "change": "added"}
        for s in added
    ]
    removed_data = [
        {"date": s.date, "shift_type": s.shift_type, "display_name": s.user.display_name if s.user else "?", "change": "removed"}
        for s in removed
    ]
    background_tasks.add_task(schedule_pending_notifications, scheduler)
    background_tasks.add_task(notify_schedule_published, added_data + removed_data, start_date, end_date)
    return {"published": len(added), "removed": len(removed)}


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
    time_off = await get_or_404(db, TimeOffRequest, request_id)
    time_off.status = req.status
    if req.admin_comment:
        time_off.admin_comment = req.admin_comment
    await db.flush()
    await db.refresh(time_off, ["user"])
    await log_action(db, admin, "time_off_reviewed",
        f"Request {request_id} → {req.status.value}" + (f" | {req.admin_comment}" if req.admin_comment else ""))
    return TimeOffResponse.model_validate(time_off)


@router.delete("/time-off/{request_id}")
async def delete_time_off(
    request_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    time_off = await get_or_404(db, TimeOffRequest, request_id)
    if user.role != UserRole.ADMIN and time_off.user_id != user.id:
        raise HTTPException(status_code=403, detail="Not allowed")
    await db.delete(time_off)
    return {"deleted": True}


# ─── Blocked Dates (manual unavailability) ──────────────

@router.get("/blocked-dates", response_model=list[UserBlockedDateResponse])
async def list_blocked_dates(
    user_id: UUID | None = Query(None),
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    query = select(UserBlockedDate)
    if user_id:
        query = query.where(UserBlockedDate.user_id == user_id)
    query = query.order_by(UserBlockedDate.start_date)
    result = await db.execute(query)
    return [UserBlockedDateResponse.model_validate(b) for b in result.scalars().all()]


@router.post("/blocked-dates", response_model=UserBlockedDateResponse)
async def create_blocked_date(
    req: UserBlockedDateCreate,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    if req.end_date < req.start_date:
        raise HTTPException(status_code=400, detail="End date must be after start date")
    entry = UserBlockedDate(**req.model_dump())
    db.add(entry)
    await db.flush()
    await log_action(db, admin, "blocked_date_added",
        f"user {entry.user_id}: {entry.start_date} → {entry.end_date}" + (f" ({entry.reason})" if entry.reason else ""))
    return UserBlockedDateResponse.model_validate(entry)


@router.delete("/blocked-dates/{entry_id}")
async def delete_blocked_date(
    entry_id: UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    entry = await get_or_404(db, UserBlockedDate, entry_id)
    await db.delete(entry)
    await log_action(db, admin, "blocked_date_removed",
        f"user {entry.user_id}: {entry.start_date} → {entry.end_date}")
    return {"deleted": True}
