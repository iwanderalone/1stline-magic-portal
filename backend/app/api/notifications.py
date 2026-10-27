"""In-app notification endpoints."""
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update, func, delete
from app.core.database import get_db
from datetime import timedelta

from app.core.deps import get_current_user
from app.models.models import (
    EmailLog, HandoverRecord, Notification, TimeOffRequest, TimeOffStatus, User, UserRole, ZammadTicket, utcnow,
)
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


# Same windows the pages themselves use, so the sidebar and the page agree.
_MAIL_PAGE_LIMIT = 500          # MailReporterPage loads ?limit=500
_MAIL_STALE = timedelta(hours=24)
_TICKET_STALE = timedelta(days=14)


@router.get("/nav-counts")
async def nav_counts(
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Bell count + the sidebar's live counters, in one poll.

    mail: Inbox count (not solved, within the page's 500-email window), `old`
    if any of them is older than 24h. tickets: the board's open bucket (new /
    open / in progress), `old` if any is older than 14 days. timeoff/handover:
    items waiting on an admin or manager — absent for everyone else.
    """
    from app.api.tickets import state_bucket

    unread = (await db.execute(
        select(func.count()).select_from(Notification).where(
            Notification.user_id == user.id, Notification.is_read == False,
        )
    )).scalar()
    out: dict = {"unread": unread}
    if user.role == UserRole.HR:
        return out

    now = utcnow()
    recent = (await db.execute(
        select(EmailLog.status, EmailLog.received_at, EmailLog.created_at)
        .order_by(EmailLog.created_at.desc()).limit(_MAIL_PAGE_LIMIT)
    )).all()
    inbox = [r for r in recent if r.status != "solved"]
    out["mail"] = {
        "count": len(inbox),
        "old": any(now - (r.received_at or r.created_at) > _MAIL_STALE for r in inbox if (r.received_at or r.created_at)),
    }

    tickets = [t for t in (await db.execute(
        select(ZammadTicket.state, ZammadTicket.zammad_created_at, ZammadTicket.state_changed_at)
    )).all() if state_bucket(t.state) == "open"]
    out["tickets"] = {
        "count": len(tickets),
        "old": any(now - (t.zammad_created_at or t.state_changed_at) > _TICKET_STALE
                   for t in tickets if (t.zammad_created_at or t.state_changed_at)),
    }

    if user.role in (UserRole.ADMIN, UserRole.MANAGER):
        out["timeoff"] = (await db.execute(
            select(func.count()).select_from(TimeOffRequest).where(TimeOffRequest.status == TimeOffStatus.PENDING)
        )).scalar()
        out["handover"] = (await db.execute(
            select(func.count()).select_from(HandoverRecord).where(HandoverRecord.status == "pending")
        )).scalar()
    return out


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
