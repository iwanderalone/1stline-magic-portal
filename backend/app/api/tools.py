"""Tools API — utilities for engineers. Currently: Mailbox Backup.

POST /tools/mailbox-backup        start a backup job (email + app password)
GET  /tools/mailbox-backup/jobs   paginated jobs, active ones pinned first (passwords are never stored)
GET  /tools/mailbox-backup/jobs/{id}   one job with live progress
POST /tools/mailbox-backup/jobs/{id}/cancel   cancel a queued/running job
GET  /tools/status                which tools are configured
"""
import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, desc, func, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user, get_or_404
from app.models.models import MailboxBackupJob, User, utcnow
from app.schemas.schemas import MailboxBackupBatchStart, MailboxBackupJobResponse, MailboxBackupJobsPage
from app.services import mailbox_backup_service as mbs
from app.services.audit import log_action

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tools", tags=["tools"])


def _overlay_progress(job: MailboxBackupJob) -> MailboxBackupJobResponse:
    """Merge the live in-memory progress into the DB row for running jobs."""
    resp = MailboxBackupJobResponse.model_validate(job)
    prog = mbs.JOBS.get(job.id)
    if prog and job.status in ("queued", "running"):
        resp.phase = prog.phase
        resp.folders_total = prog.folders_total
        resp.folders_done = prog.folders_done
        resp.messages_total = prog.messages_total
        resp.messages_done = prog.messages_done
        resp.current_folder = prog.current_folder or None
    return resp


@router.get("/status")
async def tools_status(_: User = Depends(get_current_user)):
    return {"mailbox_backup": mbs.enabled()}


@router.post("/mailbox-backup", response_model=list[MailboxBackupJobResponse], status_code=201)
async def start_mailbox_backup(
    payload: MailboxBackupBatchStart,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Start one or more backup jobs. Jobs run sequentially (one pipeline at a time)."""
    if not mbs.enabled():
        raise HTTPException(status_code=503, detail="Mailbox backup is not configured (S3 credentials missing)")

    entries = [(e.email.strip().lower(), e.password) for e in payload.entries]
    emails = [e for e, _ in entries]
    dupes = {e for e in emails if emails.count(e) > 1}
    if dupes:
        raise HTTPException(status_code=400, detail=f"Duplicate addresses in batch: {', '.join(sorted(dupes))}")
    busy = [e for e in emails if mbs.is_email_busy(e)]
    if busy:
        raise HTTPException(status_code=409, detail=f"Backup already running/queued for: {', '.join(busy)}")

    jobs: list[MailboxBackupJob] = []
    for email, _pw in entries:
        job = MailboxBackupJob(
            email=email,
            requested_by=user.display_name or user.username,
            status="queued",
        )
        db.add(job)
        jobs.append(job)
    await log_action(db, user, "mailbox_backup_started",
                     f"Mailbox backup started for {len(entries)} mailbox(es): {', '.join(emails)}")
    await db.commit()
    for job in jobs:
        await db.refresh(job)

    # Fire-and-forget: pipelines run in worker threads, serialized by a global
    # lock (FIFO). Passwords stay in memory for the job and are never persisted.
    for job, (email, pw) in zip(jobs, entries):
        asyncio.create_task(mbs.run_backup_job(job.id, email, pw))
    logger.info("[tools] %s started %d mailbox backup job(s): %s",
                user.username, len(jobs), ", ".join(emails))
    return [_overlay_progress(j) for j in jobs]


@router.get("/mailbox-backup/jobs", response_model=MailboxBackupJobsPage)
async def list_backup_jobs(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=10, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Active jobs (queued/running) sort first — oldest-queued first, matching
    the FIFO order they'll actually run in — so a batch in progress is always
    visible on page 1 without paging. Finished jobs follow, newest first."""
    is_active = MailboxBackupJob.status.in_(("queued", "running"))
    active_group = case((is_active, 0), else_=1)
    active_order = case((is_active, MailboxBackupJob.created_at))       # ASC within active
    finished_order = case((is_active, None), else_=MailboxBackupJob.created_at)  # DESC within finished
    total = (await db.execute(select(func.count()).select_from(MailboxBackupJob))).scalar() or 0
    res = await db.execute(
        select(MailboxBackupJob)
        .order_by(active_group, active_order.asc(), finished_order.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return MailboxBackupJobsPage(
        items=[_overlay_progress(j) for j in res.scalars().all()],
        total=total, page=page, page_size=page_size,
    )


@router.get("/mailbox-backup/jobs/{job_id}", response_model=MailboxBackupJobResponse)
async def get_backup_job(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    job = await get_or_404(db, MailboxBackupJob, job_id)
    return _overlay_progress(job)


@router.post("/mailbox-backup/jobs/{job_id}/cancel", response_model=MailboxBackupJobResponse)
async def cancel_backup_job(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Cancel a queued or running backup job. A running pipeline stops at its
    next checkpoint (cooperative), so the status may flip a moment later."""
    job = await get_or_404(db, MailboxBackupJob, job_id)
    if job.status not in ("queued", "running"):
        raise HTTPException(status_code=400, detail=f"Job is already {job.status} — nothing to cancel")

    live = mbs.request_cancel(job_id)
    if job.status == "queued" or not live:
        # Queued jobs never reach the pipeline (it skips them), and jobs not
        # tracked by this process are orphans — finalize the row here.
        job.status = "canceled"
        job.phase = "done"
        job.finished_at = utcnow()
    await log_action(db, user, "mailbox_backup_canceled",
                     f"Mailbox backup canceled for {job.email}")
    await db.commit()
    await db.refresh(job)
    logger.info("[tools] %s canceled mailbox backup job %s (%s)", user.username, job_id, job.email)
    return _overlay_progress(job)
