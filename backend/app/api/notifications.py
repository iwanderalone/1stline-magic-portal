"""In-app notification endpoints."""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, func, delete
from app.core.database import get_db
from app.core.deps import get_current_user, require_admin
from app.models.models import User, Notification
from app.schemas.schemas import NotificationResponse

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("/", response_model=list[NotificationResponse])
async def list_notifications(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Notification)
        .where(Notification.user_id == user.id)
        .order_by(Notification.created_at.desc())
        .limit(50)
    )
    return [NotificationResponse.model_validate(n) for n in result.scalars().all()]


@router.get("/unread-count")
async def unread_count(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(func.count()).select_from(Notification).where(
            Notification.user_id == user.id,
            Notification.is_read == False,
        )
    )
    return {"count": result.scalar()}


@router.post("/mark-read")
async def mark_all_read(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await db.execute(
        update(Notification)
        .where(Notification.user_id == user.id, Notification.is_read == False)
        .values(is_read=True)
    )
    return {"ok": True}


@router.post("/{notif_id}/read")
async def mark_one_read(
    notif_id: UUID,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(Notification).where(
            Notification.id == notif_id,
            Notification.user_id == user.id,
        )
    )
    notif = result.scalar_one_or_none()
    if not notif:
        raise HTTPException(status_code=404)
    notif.is_read = True
    await db.flush()
    return {"ok": True}


@router.delete("/")
async def clear_my_notifications(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Delete all notifications for the current user."""
    await db.execute(delete(Notification).where(Notification.user_id == user.id))
    return {"cleared": True}


@router.delete("/admin/{user_id}")
async def clear_user_notifications(
    user_id: UUID,
    admin: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin: delete all notifications for a specific user."""
    await db.execute(delete(Notification).where(Notification.user_id == user_id))
    return {"cleared": True}
