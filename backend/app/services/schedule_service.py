"""Schedule auto-generation with constraint satisfaction."""
from datetime import date, timedelta
from collections import defaultdict
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from app.models.models import User, Shift, TimeOffRequest, ShiftType, TimeOffStatus, UserRole
from typing import Optional
import random


async def get_approved_time_off(
    db: AsyncSession, user_ids: list, start: date, end: date
) -> dict[str, set[date]]:
    """Return a dict of user_id -> set of dates they're off."""
    result = await db.execute(
        select(TimeOffRequest).where(
            and_(
                TimeOffRequest.user_id.in_(user_ids),
                TimeOffRequest.status == TimeOffStatus.APPROVED,
                TimeOffRequest.start_date <= end,
                TimeOffRequest.end_date >= start,
            )
        )
    )
    off_map: dict[str, set[date]] = defaultdict(set)
    for req in result.scalars().all():
        d = max(req.start_date, start)
        while d <= min(req.end_date, end):
            off_map[str(req.user_id)].add(d)
            d += timedelta(days=1)
    return off_map


async def generate_schedule(
    db: AsyncSession,
    start_date: date,
    end_date: date,
    shift_types: list[ShiftType],
    user_ids: Optional[list[str]] = None,
) -> list[dict]:
    """Generate a fair schedule respecting per-user constraints."""

    # Get eligible users
    query = select(User).where(User.is_active == True, User.role == UserRole.ENGINEER)
    if user_ids:
        query = query.where(User.id.in_(user_ids))
    result = await db.execute(query)
    users = result.scalars().all()

    if not users:
        return []

    uid_list = [str(u.id) for u in users]
    user_map = {str(u.id): u for u in users}

    # Get existing shifts in range
    existing = await db.execute(
        select(Shift).where(
            and_(Shift.date >= start_date, Shift.date <= end_date)
        )
    )
    existing_shifts = {(str(s.user_id), s.date) for s in existing.scalars().all()}

    # Get time-off
    off_map = await get_approved_time_off(db, uid_list, start_date, end_date)

    # Track assignments
    shift_counts: dict[str, int] = defaultdict(int)
    last_shift_date: dict[str, date] = {}
    weekly_counts: dict[str, dict[int, int]] = defaultdict(lambda: defaultdict(int))
    assignments: list[dict] = []

    current = start_date
    while current <= end_date:
        for stype in shift_types:
            # Find eligible users for this slot
            candidates = []
            for uid in uid_list:
                user = user_map[uid]

                # Skip if already assigned this date
                if (uid, current) in existing_shifts:
                    continue

                # Skip if on time off
                if current in off_map.get(uid, set()):
                    continue

                # Respect min gap
                if uid in last_shift_date:
                    gap = (current - last_shift_date[uid]).days
                    if gap < user.min_shift_gap_days:
                        continue

                # Respect weekly max
                week_num = current.isocalendar()[1]
                if weekly_counts[uid][week_num] >= user.max_shifts_per_week:
                    continue

                candidates.append(uid)

            if not candidates:
                continue

            # Pick the person with fewest shifts (greedy balancing)
            candidates.sort(key=lambda u: (shift_counts[u], random.random()))
            chosen = candidates[0]

            assignment = {
                "user_id": chosen,
                "date": current,
                "shift_type": stype,
            }
            assignments.append(assignment)

            # Update trackers
            shift_counts[chosen] += 1
            last_shift_date[chosen] = current
            week_num = current.isocalendar()[1]
            weekly_counts[chosen][week_num] += 1
            existing_shifts.add((chosen, current))

        current += timedelta(days=1)

    return assignments
