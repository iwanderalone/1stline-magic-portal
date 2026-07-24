"""Tools API — utilities for engineers. Currently: Mailbox Backup, Inventory
(NetBox), Handover PDF generator.

POST /tools/mailbox-backup        start a backup job (email + app password)
GET  /tools/mailbox-backup/jobs   paginated jobs, active ones pinned first (passwords are never stored)
GET  /tools/mailbox-backup/jobs/{id}   one job with live progress
POST /tools/mailbox-backup/jobs/{id}/cancel   cancel a queued/running job
GET  /tools/inventory/devices                 list/search NetBox devices
GET  /tools/inventory/devices/{id}            device detail
POST /tools/inventory/devices                 create device (admin/manager)
PATCH /tools/inventory/devices/{id}           update device (admin/manager) — no delete route exists
GET  /tools/inventory/device-types|sites|device-roles|manufacturers   lookups for form dropdowns
POST /tools/inventory/handover                generate a handover PDF (works without NetBox)
GET  /tools/status                which tools are configured
"""
import asyncio
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy import select, desc, func, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user, get_or_404, require_admin_or_manager
from app.models.models import MailboxBackupJob, User, utcnow
from app.schemas.schemas import (
    HandoverGenerate,
    MailboxBackupBatchStart,
    MailboxBackupJobResponse,
    MailboxBackupJobsPage,
    NetboxDeviceCreate,
    NetboxDeviceDetail,
    NetboxDevicesPage,
    NetboxDeviceUpdate,
    NetboxLookupItem,
)
from app.services import mailbox_backup_service as mbs
from app.services import netbox_service as nbs
from app.services.audit import log_action
from app.services.handover_pdf_service import generate_handover_pdf
from app.core.config import get_settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tools", tags=["tools"])


def _netbox_unavailable() -> HTTPException:
    return HTTPException(status_code=503, detail="NetBox is not configured (NETBOX_URL/NETBOX_API_TOKEN missing)")


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
        resp.bytes_total = prog.bytes_total
        resp.bytes_done = prog.bytes_done
        resp.current_folder = prog.current_folder or None
    return resp


@router.get("/status")
async def tools_status(_: User = Depends(get_current_user)):
    return {"mailbox_backup": mbs.enabled(), "netbox": nbs.enabled()}


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


# ─── Inventory (NetBox) ───────────────────────────────────

@router.get("/inventory/devices", response_model=NetboxDevicesPage)
async def list_devices(
    q: str | None = None,
    site: int | None = None,
    role: int | None = None,
    status: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    _: User = Depends(get_current_user),
):
    if not nbs.enabled():
        raise _netbox_unavailable()
    try:
        return await nbs.list_devices(q=q, site=site, role=role, status=status, page=page, page_size=page_size)
    except nbs.NetboxError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))


@router.get("/inventory/devices/{device_id}", response_model=NetboxDeviceDetail)
async def get_device(device_id: int, _: User = Depends(get_current_user)):
    if not nbs.enabled():
        raise _netbox_unavailable()
    try:
        return await nbs.get_device(device_id)
    except nbs.NetboxError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))


@router.post("/inventory/devices", response_model=NetboxDeviceDetail, status_code=201)
async def create_device(
    payload: NetboxDeviceCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin_or_manager),
):
    if not nbs.enabled():
        raise _netbox_unavailable()
    try:
        device = await nbs.create_device(payload)
    except nbs.NetboxError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
    await log_action(db, user, "inventory_device_created", f"NetBox device created: {payload.name} (id={device.id})")
    await db.commit()
    logger.info("[tools] %s created NetBox device %s (id=%s)", user.username, payload.name, device.id)
    return device


@router.patch("/inventory/devices/{device_id}", response_model=NetboxDeviceDetail)
async def update_device(
    device_id: int,
    payload: NetboxDeviceUpdate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin_or_manager),
):
    if not nbs.enabled():
        raise _netbox_unavailable()
    try:
        device = await nbs.update_device(device_id, payload)
    except nbs.NetboxError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
    await log_action(db, user, "inventory_device_updated", f"NetBox device updated: id={device_id}")
    await db.commit()
    logger.info("[tools] %s updated NetBox device id=%s", user.username, device_id)
    return device


@router.get("/inventory/device-types", response_model=list[NetboxLookupItem])
async def list_device_types(_: User = Depends(get_current_user)):
    if not nbs.enabled():
        raise _netbox_unavailable()
    try:
        return await nbs.list_device_types()
    except nbs.NetboxError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))


@router.get("/inventory/sites", response_model=list[NetboxLookupItem])
async def list_sites(_: User = Depends(get_current_user)):
    if not nbs.enabled():
        raise _netbox_unavailable()
    try:
        return await nbs.list_sites()
    except nbs.NetboxError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))


@router.get("/inventory/device-roles", response_model=list[NetboxLookupItem])
async def list_device_roles(_: User = Depends(get_current_user)):
    if not nbs.enabled():
        raise _netbox_unavailable()
    try:
        return await nbs.list_device_roles()
    except nbs.NetboxError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))


@router.get("/inventory/manufacturers", response_model=list[NetboxLookupItem])
async def list_manufacturers(_: User = Depends(get_current_user)):
    if not nbs.enabled():
        raise _netbox_unavailable()
    try:
        return await nbs.list_manufacturers()
    except nbs.NetboxError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))


# ─── Handover PDF generator ───────────────────────────────

@router.post("/inventory/handover")
async def generate_handover(
    payload: HandoverGenerate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Stateless: builds the PDF in-memory and streams it back. Not gated on
    NetBox (device lines are free-text), only audit-logged."""
    assignor_name = get_settings().HANDOVER_ASSIGNOR_NAME
    pdf_bytes = generate_handover_pdf(payload, assignor_name)
    await log_action(
        db, user, "inventory_handover_generated",
        f"Handover generated for {payload.employee_name} ({len(payload.devices)} device line(s))",
    )
    await db.commit()
    logger.info("[tools] %s generated a handover PDF for %s", user.username, payload.employee_name)
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in payload.employee_name)[:60] or "handover"
    filename = f"handover-{safe_name}-{payload.date.isoformat()}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
