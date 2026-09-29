"""Schedule auto-generation with constraint satisfaction."""
import json
from uuid import UUID
from datetime import date, timedelta
from collections import defaultdict
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from app.models.models import (
    User, Shift, TimeOffRequest, UserBlockedDate, ShiftType, ShiftConfig,
    TimeOffStatus, UserRole, ShiftRotation, RotationMode,
)
from typing import Optional
import random

# Shift types considered "daytime" — mutually compatible with each other but not with NIGHT.
DAYTIME_SHIFT_TYPES = {ShiftType.DAY, ShiftType.OFFICE}


async def get_blocked_dates(db, user_ids, start, end):
    uuid_ids = [UUID(u) if isinstance(u, str) else u for u in user_ids]
    result = await db.execute(
        select(UserBlockedDate).where(
            and_(
                UserBlockedDate.user_id.in_(uuid_ids),
                UserBlockedDate.start_date <= end,
                UserBlockedDate.end_date >= start,
            )
        )
    )
    blocked_map = defaultdict(set)
    for entry in result.scalars().all():
        d = max(entry.start_date, start)
        while d <= min(entry.end_date, end):
            blocked_map[str(entry.user_id)].add(d)
            d += timedelta(days=1)
    return blocked_map


async def validate_shift_assignment(
    db: AsyncSession,
    user_id,
    shift_date: date,
    shift_type: ShiftType,
    exclude_shift_id=None,
):
    """Raise HTTPException(400) if assigning `shift_type` to `user_id` on `shift_date`
    would violate day/night/office compatibility rules or a manual unavailability block."""
    blocked = await db.execute(
        select(UserBlockedDate).where(
            and_(
                UserBlockedDate.user_id == user_id,
                UserBlockedDate.start_date <= shift_date,
                UserBlockedDate.end_date >= shift_date,
            )
        )
    )
    block = blocked.scalars().first()
    if block:
        detail = f"Engineer is marked unavailable on {shift_date}"
        if block.reason:
            detail += f" ({block.reason})"
        raise HTTPException(status_code=400, detail=detail)

    query = select(Shift).where(
        and_(
            Shift.user_id == user_id,
            Shift.date >= shift_date - timedelta(days=1),
            Shift.date <= shift_date + timedelta(days=1),
        )
    )
    if exclude_shift_id is not None:
        query = query.where(Shift.id != exclude_shift_id)
    result = await db.execute(query)
    others = result.scalars().all()

    same_day_types = {s.shift_type for s in others if s.date == shift_date}
    prev_day_types = {s.shift_type for s in others if s.date == shift_date - timedelta(days=1)}
    next_day_types = {s.shift_type for s in others if s.date == shift_date + timedelta(days=1)}

    if shift_type == ShiftType.NIGHT:
        if same_day_types & DAYTIME_SHIFT_TYPES:
            raise HTTPException(status_code=400, detail="Engineer already has a day/office shift on this date — cannot also work a night shift")
        if next_day_types & DAYTIME_SHIFT_TYPES:
            raise HTTPException(status_code=400, detail="Engineer has a day/office shift the next day — needs rest after a night shift")
    else:
        if ShiftType.NIGHT in same_day_types:
            raise HTTPException(status_code=400, detail="Engineer already has a night shift on this date")
        if ShiftType.NIGHT in prev_day_types:
            raise HTTPException(status_code=400, detail="Engineer worked a night shift the previous day — needs rest before a day/office shift")


async def get_approved_time_off(db, user_ids, start, end):
    # user_ids may be strings or UUID objects; SQLAlchemy Uuid(as_uuid=True) requires UUID objects
    uuid_ids = [UUID(u) if isinstance(u, str) else u for u in user_ids]
    result = await db.execute(
        select(TimeOffRequest).where(
            and_(
                TimeOffRequest.user_id.in_(uuid_ids),
                TimeOffRequest.status == TimeOffStatus.APPROVED,
                TimeOffRequest.start_date <= end,
                TimeOffRequest.end_date >= start,
            )
        )
    )
    off_map = defaultdict(set)
    for req in result.scalars().all():
        d = max(req.start_date, start)
        while d <= min(req.end_date, end):
            off_map[str(req.user_id)].add(d)
            d += timedelta(days=1)
    return off_map


async def get_shift_config_map(db) -> dict:
    result = await db.execute(select(ShiftConfig).where(ShiftConfig.is_active == True))
    return {c.shift_type: c for c in result.scalars().all()}


async def get_active_rotations(db, shift_types: list[ShiftType]) -> dict:
    """One parsed active rotation per shift type (if several are active for the same
    type, the most recently updated one wins — callers should keep at most one active
    per type). Returns {shift_type: {mode, user_ids: [str], anchor_date, weekdays}}."""
    result = await db.execute(
        select(ShiftRotation).where(
            and_(ShiftRotation.shift_type.in_(shift_types), ShiftRotation.is_active == True)
        ).order_by(ShiftRotation.updated_at.desc())
    )
    rotations = {}
    for r in result.scalars().all():
        if r.shift_type in rotations:
            continue  # newest already kept
        try:
            user_ids = json.loads(r.user_ids)
        except (json.JSONDecodeError, TypeError):
            user_ids = []
        try:
            weekdays = json.loads(r.weekdays) if r.weekdays else None
        except (json.JSONDecodeError, TypeError):
            weekdays = None
        rotations[r.shift_type] = {
            "mode": r.mode,
            "user_ids": [str(u) for u in user_ids],
            "anchor_date": r.anchor_date,
            "weekdays": weekdays,
        }
    return rotations


def is_available_by_pattern(user: User, check_date: date) -> bool:
    """Check if a user is available on a given date based on their cycle pattern.

    Example: User works 24h at other job, then has 3 days available.
    cycle_days=4, work_days=[2,3,4], anchor_date=2025-01-01
    Day 1 of cycle = busy at other job, Days 2-4 = available for us.
    """
    if not user.availability_pattern:
        return True

    try:
        pattern = json.loads(user.availability_pattern)
    except (json.JSONDecodeError, TypeError):
        return True

    cycle_days = pattern.get("cycle_days", 0)
    work_days = pattern.get("work_days", [])
    blocked_weekdays = pattern.get("blocked_weekdays", [])

    # Check blocked weekdays (0=Monday, 6=Sunday)
    if check_date.weekday() in blocked_weekdays:
        return False

    # Check cycle pattern
    if cycle_days > 0 and work_days:
        anchor = user.availability_anchor_date
        if not anchor:
            return True
        delta = (check_date - anchor).days
        day_in_cycle = (delta % cycle_days) + 1  # 1-indexed
        if day_in_cycle not in work_days:
            return False

    return True


async def generate_schedule(
    db: AsyncSession,
    start_date: date,
    end_date: date,
    shift_types: list[ShiftType],
    user_ids: Optional[list[UUID]] = None,
) -> list[dict]:
    query = select(User).where(User.is_active == True, User.role == UserRole.ENGINEER)
    if user_ids:
        query = query.where(User.id.in_(user_ids))
    result = await db.execute(query)
    users = result.scalars().all()
    if not users:
        return []

    uid_list = [str(u.id) for u in users]
    user_map = {str(u.id): u for u in users}
    config_map = await get_shift_config_map(db)

    existing = await db.execute(
        select(Shift).where(and_(Shift.date >= start_date, Shift.date <= end_date))
    )
    existing_shifts = {(str(s.user_id), s.date, s.shift_type) for s in existing.scalars().all()}
    off_map = await get_approved_time_off(db, uid_list, start_date, end_date)
    blocked_map = await get_blocked_dates(db, uid_list, start_date, end_date)

    # Track shift types already assigned per (user, date) — covers both pre-existing
    # shifts and new assignments made during this generation run.
    assigned_types = defaultdict(set)
    for uid, d, st in existing_shifts:
        assigned_types[(uid, d)].add(st)

    # Seed last_shift_date / last_shift_type from existing shifts just before the range.
    # This prevents the generator from assigning e.g. a DAY shift the day after an
    # already-existing NIGHT shift (which would create an effective 24h work period).
    lookback_start = start_date - timedelta(days=3)
    prior_result = await db.execute(
        select(Shift).where(
            and_(
                Shift.date >= lookback_start,
                Shift.date < start_date,
                Shift.user_id.in_([UUID(uid) for uid in uid_list]),
            )
        ).order_by(Shift.date.desc())
    )
    last_shift_date: dict = {}
    last_shift_type: dict = {}
    for s in prior_result.scalars().all():
        uid = str(s.user_id)
        if uid not in last_shift_date:   # desc order → keep most recent
            last_shift_date[uid] = s.date
            last_shift_type[uid] = s.shift_type

    shift_counts = defaultdict(int)
    weekly_counts = defaultdict(lambda: defaultdict(int))
    assignments = []
    rotations = await get_active_rotations(db, shift_types)

    def eligible(uid, current, stype):
        user = user_map.get(uid)
        if user is None:
            return False
        if (uid, current, stype) in existing_shifts:
            return False
        if current in off_map.get(uid, set()):
            return False
        if current in blocked_map.get(uid, set()):
            return False
        if not is_available_by_pattern(user, current):
            return False
        # Day/night/office compatibility: night cannot coexist with day/office
        # on the same date (and vice versa).
        same_day_types = assigned_types.get((uid, current), set())
        if stype == ShiftType.NIGHT:
            if same_day_types & DAYTIME_SHIFT_TYPES:
                return False
            # A night shift today rules out day/office tomorrow — don't
            # assign it if tomorrow already has one of those.
            if assigned_types.get((uid, current + timedelta(days=1)), set()) & DAYTIME_SHIFT_TYPES:
                return False
        elif ShiftType.NIGHT in same_day_types:
            return False
        # allowed_shift_types: None = no restriction; [] = never assign; ["day"] = day only
        if user.allowed_shift_types is not None:
            try:
                allowed = json.loads(user.allowed_shift_types) if isinstance(user.allowed_shift_types, str) else user.allowed_shift_types
                if stype.value not in allowed:
                    return False
            except Exception:
                pass
        if uid in last_shift_date:
            gap = (current - last_shift_date[uid]).days
            if gap < user.min_shift_gap_days:
                return False
            # Never assign a DAY/OFFICE shift the day after a NIGHT shift —
            # night ends ~08:00, day/office starts ~08:00 → effectively 0h rest
            if gap == 1 and last_shift_type.get(uid) == ShiftType.NIGHT and stype in DAYTIME_SHIFT_TYPES:
                return False
        week_num = current.isocalendar()[1]
        if weekly_counts[uid][week_num] >= user.max_shifts_per_week:
            return False
        return True

    def assign(uid, current, stype):
        config = config_map.get(stype)
        assignments.append({
            "user_id": user_map[uid].id,  # uuid.UUID, not str — avoids bind processor error
            "date": current,
            "shift_type": stype,
            "start_time": config.default_start_time if config else None,
            "end_time": config.default_end_time if config else None,
        })
        shift_counts[uid] += 1
        last_shift_date[uid] = current
        last_shift_type[uid] = stype
        week_num = current.isocalendar()[1]
        weekly_counts[uid][week_num] += 1
        existing_shifts.add((uid, current, stype))
        assigned_types[(uid, current)].add(stype)

    current = start_date
    while current <= end_date:
        for stype in shift_types:
            rotation = rotations.get(stype)

            if rotation:
                weekdays = rotation["weekdays"]
                if weekdays is not None and current.weekday() not in weekdays:
                    continue  # rotation defines this shift type as not running today
                rotation_uids = [u for u in rotation["user_ids"] if u in uid_list]
                if not rotation_uids:
                    continue
                if rotation["mode"] == RotationMode.TEAM:
                    chosen_uids = [u for u in rotation_uids if eligible(u, current, stype)]
                else:
                    idx = (current - rotation["anchor_date"]).days % len(rotation_uids)
                    turn_uid = rotation_uids[idx]
                    chosen_uids = [turn_uid] if eligible(turn_uid, current, stype) else []
                for uid in chosen_uids:
                    assign(uid, current, stype)
                continue  # rotation fully decides this (day, shift type) — skip load-balanced fallback

            candidates = [uid for uid in uid_list if eligible(uid, current, stype)]
            if not candidates:
                continue
            candidates.sort(key=lambda u: (shift_counts[u], random.random()))
            assign(candidates[0], current, stype)

        current += timedelta(days=1)

    return assignments


async def copy_week_shifts(
    db: AsyncSession,
    source_start_date: date,
    target_start_date: date,
    days: int = 7,
    shift_types: Optional[list[ShiftType]] = None,
) -> list[dict]:
    """Clone published shifts from [source_start_date, +days) into a same-length
    window starting at target_start_date, preserving each shift's offset from the
    start of its window. A (user, date, shift_type) already present in the target
    range is left untouched rather than duplicated — matches how admins actually
    work today for cadences (office, night) that repeat week over week."""
    source_end = source_start_date + timedelta(days=days - 1)
    target_end = target_start_date + timedelta(days=days - 1)

    filters = [
        Shift.date >= source_start_date, Shift.date <= source_end,
        Shift.is_published == True, Shift.pending_delete == False,
    ]
    if shift_types:
        filters.append(Shift.shift_type.in_(shift_types))
    source_result = await db.execute(select(Shift).where(and_(*filters)))
    source_shifts = source_result.scalars().all()

    existing_result = await db.execute(
        select(Shift).where(and_(Shift.date >= target_start_date, Shift.date <= target_end))
    )
    existing = {(str(s.user_id), s.date, s.shift_type) for s in existing_result.scalars().all()}

    assignments = []
    seen = set()
    for s in source_shifts:
        offset = (s.date - source_start_date).days
        new_date = target_start_date + timedelta(days=offset)
        key = (str(s.user_id), new_date, s.shift_type)
        if key in existing or key in seen:
            continue
        seen.add(key)
        assignments.append({
            "user_id": s.user_id,
            "date": new_date,
            "shift_type": s.shift_type,
            "start_time": s.start_time,
            "end_time": s.end_time,
            "location": s.location,
        })
    return assignments
