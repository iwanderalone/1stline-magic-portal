"""Mail Reporter API — CRUD for mailbox configs + email log viewer."""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from sqlalchemy import select, delete, desc, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user, require_admin, get_or_404
from app.models.models import MailboxConfig, EmailLog, EmailComment, EmailReply, MailRoutingRule, User
from app.schemas.schemas import (
    MailboxConfigCreate, MailboxConfigUpdate, MailboxConfigResponse, EmailLogResponse,
    EmailLogDetailResponse, EmailLogUpdate, EmailCommentCreate, EmailCommentResponse,
    EmailReplyCreate, EmailReplyResponse,
    MailRoutingRuleCreate, MailRoutingRuleUpdate, MailRoutingRuleResponse,
)
from app.services.smtp_service import send_reply, extract_address, SmtpError
from app.services.mail_reporter_service import (
    _test_imap_connection, check_all_mailboxes,
)
from app.core.encryption import encrypt, decrypt

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

    data = body.model_dump()
    if data.get("password"):
        data["password"] = encrypt(data["password"])
    mb = MailboxConfig(**data)
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
    mb = await get_or_404(db, MailboxConfig, mailbox_id)

    for field, value in body.model_dump(exclude_unset=True).items():
        if field == "password" and value:
            value = encrypt(value)
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
    mb = await get_or_404(db, MailboxConfig, mailbox_id)
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
    mb = await get_or_404(db, MailboxConfig, mailbox_id)
    result = await asyncio.to_thread(_test_imap_connection, mb.email, decrypt(mb.password))
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

    # Comment counts in one query
    counts_result = await db.execute(
        select(EmailComment.email_id, func.count(EmailComment.id).label("cnt"))
        .group_by(EmailComment.email_id)
    )
    comment_counts = {row.email_id: row.cnt for row in counts_result}

    # Latest comment per email (for list previews) — chronological scan keeps the newest
    latest_result = await db.execute(
        select(EmailComment.email_id, EmailComment.username, EmailComment.text)
        .order_by(EmailComment.created_at)
    )
    latest_comments = {row.email_id: f"{row.username}: {row.text}" for row in latest_result}

    # Sent-reply counts (replied marker)
    reply_counts_result = await db.execute(
        select(EmailReply.email_id, func.count(EmailReply.id).label("cnt"))
        .where(EmailReply.status == "sent")
        .group_by(EmailReply.email_id)
    )
    reply_counts = {row.email_id: row.cnt for row in reply_counts_result}

    # Attach mailbox_email for display
    mailbox_cache: dict[int, str] = {}
    out = []
    for log in logs:
        if log.mailbox_id not in mailbox_cache:
            mb = await db.get(MailboxConfig, log.mailbox_id)
            mailbox_cache[log.mailbox_id] = mb.email if mb else "deleted"
        data = EmailLogResponse.model_validate(log)
        data.mailbox_email = mailbox_cache[log.mailbox_id]
        data.comment_count = comment_counts.get(log.id, 0)
        data.last_comment = latest_comments.get(log.id)
        data.reply_count = reply_counts.get(log.id, 0)
        out.append(data)
    return out


@router.get(
    "/replies",
    response_model=list[EmailReplyResponse],
    summary="List recent outbound replies (Sent view)",
)
async def list_all_replies(
    limit: int = Query(default=100, ge=1, le=300),
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(
        select(EmailReply).order_by(desc(EmailReply.created_at)).limit(limit)
    )
    return result.scalars().all()


@router.get("/emails/{email_id}", response_model=EmailLogDetailResponse)
async def get_email_log(
    email_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    log = await get_or_404(db, EmailLog, email_id)
    mb = await db.get(MailboxConfig, log.mailbox_id)
    count_result = await db.execute(
        select(func.count(EmailComment.id)).where(EmailComment.email_id == log.id)
    )
    data = EmailLogDetailResponse.model_validate(log)
    data.mailbox_email = mb.email if mb else "deleted"
    data.comment_count = count_result.scalar() or 0
    return data


@router.patch("/emails/{email_id}", response_model=EmailLogResponse)
async def update_email_log(
    email_id: int,
    body: EmailLogUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    """Mark an email as solved / add a comment. Accessible to all authenticated users."""
    from datetime import datetime, timezone
    log = await get_or_404(db, EmailLog, email_id)

    updates = body.model_dump(exclude_unset=True)
    for field, value in updates.items():
        setattr(log, field, value)

    # Maintain solved_at based on status
    if "status" in updates:
        if updates["status"] == "solved" and not log.solved_at:
            log.solved_at = datetime.now(timezone.utc)
        elif updates["status"] != "solved":
            log.solved_at = None

    await db.commit()
    await db.refresh(log)

    counts_result = await db.execute(
        select(func.count(EmailComment.id)).where(EmailComment.email_id == log.id)
    )
    comment_count = counts_result.scalar_one()

    mb = await db.get(MailboxConfig, log.mailbox_id)
    data = EmailLogResponse.model_validate(log)
    data.mailbox_email = mb.email if mb else "deleted"
    data.comment_count = comment_count
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


# ─── Routing Rules CRUD ───────────────────────────────────────────────

@router.get("/rules", response_model=list[MailRoutingRuleResponse])
async def list_rules(
    mailbox_id: Optional[int] = Query(None, description="Filter to rules for a specific mailbox (includes global rules)"),
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    """Return routing rules ordered by priority, then id.

    If mailbox_id is provided, returns built-in rules + rules scoped to that
    mailbox + global custom rules (mailbox_id IS NULL). Without mailbox_id,
    all rules are returned.
    """
    q = select(MailRoutingRule)
    if mailbox_id is not None:
        q = q.where(
            or_(
                MailRoutingRule.is_builtin == True,
                MailRoutingRule.mailbox_id == None,
                MailRoutingRule.mailbox_id == mailbox_id,
            )
        )
    q = q.order_by(MailRoutingRule.priority, MailRoutingRule.id)
    result = await db.execute(q)
    return result.scalars().all()


@router.post("/rules", response_model=MailRoutingRuleResponse, status_code=201)
async def create_rule(
    body: MailRoutingRuleCreate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    rule = MailRoutingRule(**body.model_dump(), is_builtin=False)
    db.add(rule)
    await db.commit()
    await db.refresh(rule)
    logger.info(f"[mail-reporter] Rule created: {rule.name}")
    return rule


@router.patch("/rules/{rule_id}", response_model=MailRoutingRuleResponse)
async def update_rule(
    rule_id: int,
    body: MailRoutingRuleUpdate,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    rule = await get_or_404(db, MailRoutingRule, rule_id)

    updates = body.model_dump(exclude_unset=True)

    # General built-in is a pure catch-all — match conditions don't apply to it.
    # All other built-in rules can have custom match_values to extend detection.
    if rule.is_builtin and rule.builtin_key == "general":
        forbidden = {"match_type", "match_values", "priority"}
        blocked = forbidden & set(updates.keys())
        if blocked:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot modify {', '.join(blocked)} on the General catch-all rule"
            )

    for field, value in updates.items():
        setattr(rule, field, value)
    rule.updated_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(rule)
    logger.info(f"[mail-reporter] Rule updated: {rule.name}")
    return rule


@router.delete("/rules/{rule_id}")
async def delete_rule(
    rule_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(require_admin),
):
    rule = await get_or_404(db, MailRoutingRule, rule_id)
    if rule.is_builtin and rule.builtin_key == "general":
        raise HTTPException(status_code=400, detail="Cannot delete the General catch-all rule")

    name = rule.name
    await db.delete(rule)
    await db.commit()
    logger.info(f"[mail-reporter] Rule deleted: {name}")
    return {"ok": True}


# ─── Email Comments ───────────────────────────────────────────────────

@router.get("/emails/{email_id}/comments", response_model=list[EmailCommentResponse])
async def list_comments(
    email_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(
        select(EmailComment)
        .where(EmailComment.email_id == email_id)
        .order_by(EmailComment.created_at)
    )
    return result.scalars().all()


@router.post("/emails/{email_id}/comments", response_model=EmailCommentResponse, status_code=201)
async def add_comment(
    email_id: int,
    body: EmailCommentCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    log = await get_or_404(db, EmailLog, email_id)
    comment = EmailComment(
        email_id=email_id,
        user_id=current_user.id,
        username=current_user.display_name or current_user.username,
        text=body.text,
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)
    return comment


# ─── Outbound replies (SMTP) ─────────────────────────────────────────

@router.get("/emails/{email_id}/replies", response_model=list[EmailReplyResponse])
async def list_replies(
    email_id: int,
    db: AsyncSession = Depends(get_db),
    _=Depends(get_current_user),
):
    result = await db.execute(
        select(EmailReply).where(EmailReply.email_id == email_id).order_by(EmailReply.created_at)
    )
    return result.scalars().all()


@router.post(
    "/emails/{email_id}/reply",
    response_model=EmailReplyResponse,
    status_code=201,
    summary="Send an SMTP reply to the original sender",
    description=(
        "Sends 'Re: <subject>' back to the email's sender, from the mailbox that received it "
        "(reusing its stored credentials via the configured SMTP server). The sent reply is "
        "logged and shown in the email's activity thread."
    ),
)
async def reply_to_email(
    email_id: int,
    payload: EmailReplyCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    log = await get_or_404(db, EmailLog, email_id)
    mailbox = await db.get(MailboxConfig, log.mailbox_id)
    if not mailbox:
        raise HTTPException(status_code=409, detail="The mailbox for this email no longer exists")

    to_addr = extract_address(log.sender)
    if not to_addr:
        raise HTTPException(status_code=422, detail=f"Cannot parse a recipient address from sender {log.sender!r}")

    subject = log.subject or ""
    if not subject.lower().startswith("re:"):
        subject = f"Re: {subject}".strip()

    reply = EmailReply(
        email_id=email_id,
        user_id=current_user.id,
        username=current_user.display_name or current_user.username,
        to_addr=to_addr,
        subject=subject[:500],
        body=payload.body,
    )
    try:
        await send_reply(mailbox, to_addr, subject, payload.body, in_reply_to=log.message_id)
        reply.status = "sent"
    except SmtpError as exc:
        reply.status = "failed"
        reply.error = str(exc)[:1000]
        db.add(reply)
        await db.commit()
        raise HTTPException(status_code=502, detail=str(exc))

    db.add(reply)
    await db.commit()
    await db.refresh(reply)
    return reply
