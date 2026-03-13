"""Reminder endpoints."""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.models import User, Reminder, ReminderStatus
from app.schemas.schemas import ReminderCreate, ReminderUpdate, ReminderResponse

router = APIRouter(prefix="/reminders", tags=["reminders"])


@router.get("/", response_model=list[ReminderResponse])
async def list_reminders(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Reminder)
        .where(Reminder.user_id == user.id)
        .order_by(Reminder.remind_at.asc())
    )
    return [ReminderResponse.model_validate(r) for r in result.scalars().all()]


@router.get("/active", response_model=list[ReminderResponse])
async def list_active_reminders(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Reminder).where(
            and_(
                Reminder.user_id == user.id,
                Reminder.status == ReminderStatus.ACTIVE,
            )
        ).order_by(Reminder.remind_at.asc())
    )
    return [ReminderResponse.model_validate(r) for r in result.scalars().all()]


@router.post("/", response_model=ReminderResponse)
async def create_reminder(
    req: ReminderCreate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    reminder = Reminder(user_id=user.id, **req.model_dump())
    db.add(reminder)
    await db.flush()
    await db.refresh(reminder)
    return ReminderResponse.model_validate(reminder)


@router.patch("/{reminder_id}", response_model=ReminderResponse)
async def update_reminder(
    reminder_id: str,
    req: ReminderUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Reminder).where(
            and_(Reminder.id == reminder_id, Reminder.user_id == user.id)
        )
    )
    reminder = result.scalar_one_or_none()
    if not reminder:
        raise HTTPException(status_code=404)

    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(reminder, field, value)

    await db.flush()
    await db.refresh(reminder)
    return ReminderResponse.model_validate(reminder)


@router.delete("/{reminder_id}")
async def cancel_reminder(
    reminder_id: str,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Reminder).where(
            and_(Reminder.id == reminder_id, Reminder.user_id == user.id)
        )
    )
    reminder = result.scalar_one_or_none()
    if not reminder:
        raise HTTPException(status_code=404)

    reminder.status = ReminderStatus.CANCELLED
    await db.flush()
    return {"cancelled": True}
