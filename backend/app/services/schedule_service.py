"""Schedule auto-generation with constraint satisfaction."""
import json
from uuid import UUID
from datetime import date, timedelta
from collections import defaultdict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from app.models.models import User, Shift, TimeOffRequest, ShiftType, ShiftConfig, TimeOffStatus, UserRole
from typing import Optional
import random


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

    current = start_date
    while current <= end_date:
        for stype in shift_types:
            candidates = []
            for uid in uid_list:
                user = user_map[uid]
                if (uid, current, stype) in existing_shifts:
                    continue
                if current in off_map.get(uid, set()):
                    continue
                if not is_available_by_pattern(user, current):
                    continue
                # allowed_shift_types: None = no restriction; [] = never assign; ["day"] = day only
                if user.allowed_shift_types is not None:
                    try:
                        allowed = json.loads(user.allowed_shift_types) if isinstance(user.allowed_shift_types, str) else user.allowed_shift_types
                        if stype.value not in allowed:
                            continue
                    except Exception:
                        pass
                if uid in last_shift_date:
                    gap = (current - last_shift_date[uid]).days
                    if gap < user.min_shift_gap_days:
                        continue
                    # Never assign a DAY shift the day after a NIGHT shift —
                    # night ends ~08:00, day starts ~08:00 → effectively 0h rest
                    if gap == 1 and last_shift_type.get(uid) == ShiftType.NIGHT and stype == ShiftType.DAY:
                        continue
                week_num = current.isocalendar()[1]
                if weekly_counts[uid][week_num] >= user.max_shifts_per_week:
                    continue
                candidates.append(uid)

            if not candidates:
                continue

            candidates.sort(key=lambda u: (shift_counts[u], random.random()))
            chosen = candidates[0]

            config = config_map.get(stype)
            assignment = {
                "user_id": user_map[chosen].id,  # uuid.UUID, not str — avoids bind processor error
                "date": current,
                "shift_type": stype,
                "start_time": config.default_start_time if config else None,
                "end_time": config.default_end_time if config else None,
            }
            assignments.append(assignment)

            shift_counts[chosen] += 1
            last_shift_date[chosen] = current
            last_shift_type[chosen] = stype
            week_num = current.isocalendar()[1]
            weekly_counts[chosen][week_num] += 1
            existing_shifts.add((chosen, current, stype))

        current += timedelta(days=1)

    return assignments
