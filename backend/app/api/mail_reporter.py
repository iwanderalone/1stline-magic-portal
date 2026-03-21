"""Mail Reporter API — CRUD for mailbox configs + email log viewer."""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy import select, delete, desc
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user, require_admin
from app.models.models import MailboxConfig, EmailLog, User
from app.schemas.schemas import (
    MailboxConfigCreate, MailboxConfigUpdate, MailboxConfigResponse, EmailLogResponse,
    EmailLogUpdate,
)
from app.services.mail_reporter_service import (
    _test_imap_connection, check_all_mailboxes,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/mail-reporter", tags=["mail-reporter"])


# ─── Mailbox CRUD ─────────────────────────────────────────────────────

@router.get("/mailboxes", response_model=list[MailboxConfigResponse])
async def list_mailboxes(
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    result = await db.execute(select(MailboxConfig).order_by(MailboxConfig.id))
    return result.scalars().all()


@router.post("/mailboxes", response_model=MailboxConfigResponse, status_code=201)
async def create_mailbox(
    body: MailboxConfigCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    # Check duplicate email
    existing = await db.execute(
        select(MailboxConfig).where(MailboxConfig.email == body.email)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Mailbox with this email already exists")

    mb = MailboxConfig(**body.model_dump())
    db.add(mb)
    await db.commit()
    await db.refresh(mb)
    logger.info(f"[mail-reporter] Mailbox created: {mb.email}")
    return mb


@router.patch("/mailboxes/{mailbox_id}", response_model=MailboxConfigResponse)
async def update_mailbox(
    mailbox_id: int,
    body: MailboxConfigUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    mb = await db.get(MailboxConfig, mailbox_id)
    if not mb:
        raise HTTPException(status_code=404, detail="Mailbox not found")

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(mb, field, value)
    mb.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(mb)
    logger.info(f"[mail-reporter] Mailbox updated: {mb.email}")
    return mb


@router.delete("/mailboxes/{mailbox_id}")
async def delete_mailbox(
    mailbox_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    mb = await db.get(MailboxConfig, mailbox_id)
    if not mb:
        raise HTTPException(status_code=404, detail="Mailbox not found")
    email = mb.email
    await db.delete(mb)
    await db.commit()
    logger.info(f"[mail-reporter] Mailbox deleted: {email}")
    return {"ok": True}


# ─── Test Connection ──────────────────────────────────────────────────

@router.post("/mailboxes/{mailbox_id}/test")
async def test_mailbox_connection(
    mailbox_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    mb = await db.get(MailboxConfig, mailbox_id)
    if not mb:
        raise HTTPException(status_code=404, detail="Mailbox not found")
    result = await asyncio.to_thread(_test_imap_connection, mb.email, mb.password)
    return result


# ─── Email Log ───────────────────────────────────────────────────────

@router.get("/emails", response_model=list[EmailLogResponse])
async def list_email_logs(
    limit: int = 100,
    mailbox_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    query = select(EmailLog).order_by(desc(EmailLog.created_at)).limit(limit)
    if mailbox_id is not None:
        query = query.where(EmailLog.mailbox_id == mailbox_id)

    result = await db.execute(query)
    logs = result.scalars().all()

    # Attach mailbox_email for display
    mailbox_cache: dict[int, str] = {}
    out = []
    for log in logs:
        if log.mailbox_id not in mailbox_cache:
            mb = await db.get(MailboxConfig, log.mailbox_id)
            mailbox_cache[log.mailbox_id] = mb.email if mb else "deleted"
        data = EmailLogResponse.model_validate(log)
        data.mailbox_email = mailbox_cache[log.mailbox_id]
        out.append(data)
    return out


@router.patch("/emails/{email_id}", response_model=EmailLogResponse)
async def update_email_log(
    email_id: int,
    body: EmailLogUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Mark an email as solved / add a comment. Accessible to all authenticated users."""
    from datetime import datetime, timezone
    log = await db.get(EmailLog, email_id)
    if not log:
        raise HTTPException(status_code=404, detail="Email log not found")

    updates = body.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(log, field, value)
    if updates.get("is_solved") is True and not log.solved_at:
        log.solved_at = datetime.now(timezone.utc)
    elif updates.get("is_solved") is False:
        log.solved_at = None

    await db.commit()
    await db.refresh(log)

    # Attach mailbox_email
    mb = await db.get(MailboxConfig, log.mailbox_id)
    data = EmailLogResponse.model_validate(log)
    data.mailbox_email = mb.email if mb else "deleted"
    return data


@router.delete("/emails")
async def clear_email_logs(
    mailbox_id: Optional[int] = None,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    """Delete email logs (and dedup fingerprints). Emails will be re-processed on next poll."""
    if mailbox_id is not None:
        result = await db.execute(
            delete(EmailLog).where(EmailLog.mailbox_id == mailbox_id)
        )
    else:
        result = await db.execute(delete(EmailLog))
    await db.commit()
    deleted = result.rowcount
    logger.info(f"[mail-reporter] Cleared {deleted} email log entries")
    return {"deleted": deleted}


# ─── Manual Poll ─────────────────────────────────────────────────────

@router.post("/poll-now")
async def poll_now(background_tasks: BackgroundTasks, _=Depends(require_admin)):
    """Trigger an immediate email check in the background."""
    background_tasks.add_task(check_all_mailboxes)
    return {"started": True, "message": "Poll triggered — check logs or refresh emails shortly"}
