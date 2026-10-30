"""Tools API — utilities for engineers. Currently: Mailbox Backup, Inventory
(NetBox), Handover generator.

POST /tools/mailbox-backup        start a backup job (email + app password)
GET  /tools/mailbox-backup/jobs   paginated jobs, active ones pinned first (passwords are never stored)
GET  /tools/mailbox-backup/jobs/{id}   one job with live progress
POST /tools/mailbox-backup/jobs/{id}/cancel   cancel a queued/running job
GET  /tools/inventory/devices                 list/search NetBox devices
GET  /tools/inventory/devices/{id}            device detail
POST /tools/inventory/devices                 create device (admin/manager)
PATCH /tools/inventory/devices/{id}           update device (admin/manager) — no delete route exists
GET  /tools/inventory/device-types|sites|device-roles|manufacturers   lookups for form dropdowns
POST /tools/inventory/handover                fill the handover .docx template (works without NetBox)
GET  /tools/status                which tools are configured
"""
import asyncio
import json
import logging

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Response, UploadFile
from sqlalchemy import select, desc, func, case
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_current_user, get_or_404, require_admin_or_manager
from app.models.models import HandoverRecord, MailboxBackupJob, PurchasePayment, User, utcnow
from app.schemas.schemas import (
    HandoverGenerate,
    MailboxBackupBatchStart,
    MailboxBackupJobResponse,
    MailboxBackupJobsPage,
    NetboxDeviceCreate,
    NetboxDeviceDetail,
    NetboxDevicesPage,
    NetboxAssignment,
    NetboxContact,
    NetboxContactsPage,
    HandoverRecord as HandoverRecordIn,
    HandoverRecordOut,
    HandoverRecordResult,
    IntakeRequest,
    IntakeResult,
    ParsedInvoice,
    NetboxDeviceUpdate,
    NetboxLookupItem,
)
from app.services import mailbox_backup_service as mbs
from app.services import intake_service as intake
from app.services import netbox_service as nbs
from app.services import purchases_service as ps
from app.services.audit import log_action
from app.services.handover_service import generate_handover_docx
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
    show_failed: bool = Query(default=True),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Active jobs (queued/running) sort first — oldest-queued first, matching
    the FIFO order they'll actually run in — so a batch in progress is always
    visible on page 1 without paging. Finished jobs follow, newest first.
    `show_failed=false` hides failed jobs; `failed` is counted either way so the
    toggle can say how many are hidden."""
    is_active = MailboxBackupJob.status.in_(("queued", "running"))
    active_group = case((is_active, 0), else_=1)
    active_order = case((is_active, MailboxBackupJob.created_at))       # ASC within active
    finished_order = case((is_active, None), else_=MailboxBackupJob.created_at)  # DESC within finished
    failed = (await db.execute(
        select(func.count()).select_from(MailboxBackupJob).where(MailboxBackupJob.status == "failed")
    )).scalar() or 0
    query = select(MailboxBackupJob)
    if not show_failed:
        query = query.where(MailboxBackupJob.status != "failed")
    total = (await db.execute(select(func.count()).select_from(query.subquery()))).scalar() or 0
    res = await db.execute(
        query
        .order_by(active_group, active_order.asc(), finished_order.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return MailboxBackupJobsPage(
        items=[_overlay_progress(j) for j in res.scalars().all()],
        total=total, failed=failed, page=page, page_size=page_size,
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
    q: str | None = Query(default=None, description="Free text: name, serial or asset tag"),
    site: int | None = None,
    role: int | None = None,
    status: str | None = None,
    serial: str | None = Query(default=None, description="Exact serial match"),
    asset_tag: str | None = Query(default=None, description="Exact asset tag match"),
    device_class: str | None = Query(
        default=None,
        pattern="^(hardware|software|subscription)$",
        description="Hardware excludes the software/subscription roles",
    ),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    _: User = Depends(get_current_user),
):
    if not nbs.enabled():
        raise _netbox_unavailable()
    try:
        return await nbs.list_devices(
            q=q, site=site, role=role, status=status, serial=serial,
            asset_tag=asset_tag, device_class=device_class, page=page, page_size=page_size,
        )
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
async def list_device_types(q: str | None = None, _: User = Depends(get_current_user)):
    if not nbs.enabled():
        raise _netbox_unavailable()
    try:
        return await nbs.list_device_types(q=q.strip() if q and q.strip() else None)
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


@router.get("/inventory/tenants", response_model=list[NetboxLookupItem])
async def list_tenants(_: User = Depends(get_current_user)):
    if not nbs.enabled():
        raise _netbox_unavailable()
    try:
        return await nbs.list_tenants()
    except nbs.NetboxError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))


@router.get("/inventory/locations", response_model=list[NetboxLookupItem])
async def list_locations(_: User = Depends(get_current_user)):
    if not nbs.enabled():
        raise _netbox_unavailable()
    try:
        return await nbs.list_locations()
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


# ─── Handover generator ────────────────────────────────────

@router.post("/inventory/handover")
async def generate_handover(
    payload: HandoverGenerate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Stateless: fills the .docx template in-memory and streams it back. Not
    gated on NetBox (device lines are free-text), only audit-logged."""
    from app.core.dynamic_settings import eff
    assignor_name = eff("HANDOVER_ASSIGNOR_NAME", get_settings().HANDOVER_ASSIGNOR_NAME)
    company_name = eff("HANDOVER_COMPANY_NAME", get_settings().HANDOVER_COMPANY_NAME)
    docx_bytes = generate_handover_docx(payload, assignor_name, company_name)
    await log_action(
        db, user, "inventory_handover_generated",
        f"Handover generated for {payload.employee_name} ({len(payload.devices)} device line(s))",
    )
    await db.commit()
    logger.info("[tools] %s generated a handover doc for %s", user.username, payload.employee_name)
    safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in payload.employee_name)[:60] or "handover"
    filename = f"handover-{safe_name}-{payload.date.isoformat()}.docx"
    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get(
    "/inventory/devices/{device_id}/assignments",
    response_model=list[NetboxAssignment],
    summary="Who holds this device",
    description="Contact assignments for a device — the handover record, with the signed document.",
)
async def device_assignments(device_id: int, _: User = Depends(get_current_user)):
    if not nbs.enabled():
        raise _netbox_unavailable()
    try:
        return await nbs.list_device_assignments(device_id)
    except nbs.NetboxError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))


@router.get("/inventory/contacts", response_model=NetboxContactsPage)
async def list_contacts(
    q: str | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    _: User = Depends(get_current_user),
):
    if not nbs.enabled():
        raise _netbox_unavailable()
    try:
        return await nbs.list_contacts(q=q, page=page, page_size=page_size)
    except nbs.NetboxError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))


@router.get("/inventory/contacts/{contact_id}", response_model=NetboxContact)
async def get_contact(contact_id: int, _: User = Depends(get_current_user)):
    if not nbs.enabled():
        raise _netbox_unavailable()
    try:
        return await nbs.get_contact(contact_id)
    except nbs.NetboxError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))


@router.get(
    "/inventory/contacts/{contact_id}/assets",
    response_model=list[NetboxAssignment],
    summary="Everything a person holds",
    description="Every asset assigned to this contact — the question every offboarding asks.",
)
async def contact_assets(contact_id: int, _: User = Depends(get_current_user)):
    if not nbs.enabled():
        raise _netbox_unavailable()
    try:
        return await nbs.list_contact_assets(contact_id)
    except nbs.NetboxError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))


@router.get("/inventory/suppliers", response_model=list[str])
async def list_suppliers(_: User = Depends(get_current_user)):
    """`supplier` is required on every device and backed by a fixed choice set."""
    if not nbs.enabled():
        raise _netbox_unavailable()
    try:
        return await nbs.list_suppliers()
    except nbs.NetboxError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))


@router.post(
    "/inventory/handover/record",
    response_model=HandoverRecordResult,
    summary="Generate a handover and record it in NetBox",
    description=(
        "Builds the handover document from NetBox devices, uploads it as an attachment "
        "against each device, and creates the contact-assignment that records possession "
        "(role Handover, with signed_by, status and handover_attachment). Device status is "
        "left alone — NetBox has no 'assigned' status. A device already held by someone is "
        "skipped rather than double-assigned."
    ),
)
async def record_handover(
    payload: HandoverRecordIn,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin_or_manager),
):
    if not nbs.enabled():
        raise _netbox_unavailable()

    from app.core.dynamic_settings import eff
    from app.schemas.schemas import HandoverDeviceLine, HandoverGenerate

    try:
        employee = await nbs.get_contact(payload.employee_contact_id)
        devices = [await nbs.get_device(d) for d in payload.device_ids]

        # Refuse to hand over what someone else already holds; the operator can
        # end the existing assignment in NetBox first.
        assignable, skipped = [], []
        for device in devices:
            held_by = await nbs.active_assignment_for(device.id)
            if held_by:
                holder = (held_by.get("contact") or {}).get("name") or "someone"
                skipped.append(f"{device.name or device.id} — already held by {holder}")
            else:
                assignable.append(device)

        if not assignable:
            raise HTTPException(
                status_code=409,
                detail="Every selected device is already assigned: " + "; ".join(skipped),
            )

        # The document lines come from NetBox, so paper and inventory agree.
        lines = [
            HandoverDeviceLine(
                description=(d.device_type.display if d.device_type else None) or d.name or f"#{d.id}",
                quantity=1,
                serial_no=d.serial or None,
                inventory_no=d.asset_tag or None,
                accessories=payload.accessories,
            )
            for d in assignable
        ]
        doc_payload = HandoverGenerate(
            employee_name=employee.get("name") or "",
            position=payload.position,
            assignment_period=payload.assignment_period,
            purpose=payload.purpose,
            date=payload.date,
            devices=lines,
            comments=payload.comments,
        )
        assignor_name = eff("HANDOVER_ASSIGNOR_NAME", get_settings().HANDOVER_ASSIGNOR_NAME)
        company_name = eff("HANDOVER_COMPANY_NAME", get_settings().HANDOVER_COMPANY_NAME)
        docx_bytes = generate_handover_docx(doc_payload, assignor_name, company_name)

        safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in (employee.get("name") or ""))[:60] or "handover"
        filename = f"handover-{safe_name}-{payload.date.isoformat()}.docx"
        attachment = await nbs.upload_attachment(
            filename=filename,
            content=docx_bytes,
            display_name=f"{employee.get('name')} — handover {payload.date.isoformat()}",
            content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )

        assignments = []
        for device in assignable:
            await nbs.bind_attachment(attachment["id"], device.id)
            assignments.append(await nbs.create_handover_assignment(
                device_id=device.id,
                contact_id=payload.employee_contact_id,
                signed_by_id=payload.signed_by_contact_id,
                attachment_id=attachment["id"],
            ))
    except nbs.NetboxError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))

    record = HandoverRecord(
        employee_contact_id=payload.employee_contact_id,
        employee_name=employee.get("name") or f"contact #{payload.employee_contact_id}",
        handover_date=payload.date,
        devices=json.dumps([
            {"id": d.id, "label": (d.device_type.display if d.device_type else None) or d.name or f"#{d.id}",
             "asset_tag": d.asset_tag, "serial": d.serial}
            for d in assignable
        ]),
        assignment_ids=json.dumps([a["id"] for a in assignments]),
        draft_attachment_id=attachment["id"],
        draft_url=attachment.get("file"),
        status="pending",
        created_by=user.username,
    )
    db.add(record)
    await log_action(
        db, user, "inventory_handover_recorded",
        f"Handover for {employee.get('name')} recorded in NetBox: "
        f"{len(assignments)} device(s), attachment #{attachment['id']}"
        + (f"; skipped {len(skipped)}" if skipped else ""),
    )
    await db.commit()
    logger.info("[tools] %s recorded a handover for %s (%d device(s))",
                user.username, employee.get("name"), len(assignments))

    return HandoverRecordResult(
        record_id=record.id,
        filename=filename,
        attachment_id=attachment["id"],
        attachment_url=attachment.get("file"),
        assignments=assignments,
        skipped=skipped,
    )


# ─── Handover records: pending signature → signed ─────────────────────

@router.get("/inventory/handovers", response_model=list[HandoverRecordOut])
async def list_handovers(
    status: str | None = Query(default=None, pattern="^(pending|signed)$"),
    contact_id: int | None = None,
    limit: int = Query(default=50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin_or_manager),
):
    stmt = select(HandoverRecord).order_by(desc(HandoverRecord.created_at)).limit(limit)
    if status:
        stmt = stmt.where(HandoverRecord.status == status)
    if contact_id:
        stmt = stmt.where(HandoverRecord.employee_contact_id == contact_id)
    return (await db.execute(stmt)).scalars().all()


@router.post("/inventory/handovers/{record_id}/signed", response_model=HandoverRecordOut,
             summary="Attach the signed handover",
             description="Uploads the signed scan to NetBox, binds it to every device of this "
                         "handover and points each contact-assignment at it instead of the draft.")
async def upload_signed_handover(
    record_id: int,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin_or_manager),
):
    if not nbs.enabled():
        raise _netbox_unavailable()
    record = await get_or_404(db, HandoverRecord, record_id)
    ext, content = await _read_document(file)
    devices = json.loads(record.devices or "[]")
    name = f"{record.employee_name} — handover {record.handover_date.isoformat()} (signed)"
    try:
        attachment = await nbs.upload_attachment(
            filename=intake.attachment_filename(
                f"handover-{record.employee_name}-{record.handover_date.isoformat()}-signed", ext),
            content=content, display_name=name,
            content_type=intake.INVOICE_TYPES[ext],
        )
        for d in devices:
            await nbs.bind_attachment(attachment["id"], d["id"])
        for assignment_id in json.loads(record.assignment_ids or "[]"):
            await nbs.set_assignment_document(assignment_id, attachment["id"])
    except nbs.NetboxError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))

    record.signed_attachment_id = attachment["id"]
    record.signed_url = attachment.get("file")
    record.status = "signed"
    record.signed_at = utcnow()
    record.signed_uploaded_by = user.username
    await log_action(db, user, "inventory_handover_signed",
                     f"Signed handover for {record.employee_name} attached (#{record.id}, "
                     f"{len(devices)} device(s), attachment #{attachment['id']})")
    await db.commit()
    return record


# ─── Intake: invoice → NetBox devices → payment ───────────────────────

async def _read_document(file: UploadFile) -> tuple[str, bytes]:
    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in intake.INVOICE_TYPES:
        raise HTTPException(status_code=415, detail="PDF, PNG or JPG only")
    content = await file.read(intake.INVOICE_MAX_BYTES + 1)
    if len(content) > intake.INVOICE_MAX_BYTES:
        raise HTTPException(status_code=413, detail="File is larger than 15 MB")
    if not content:
        raise HTTPException(status_code=422, detail="The file is empty")
    return ext, content


@router.get("/inventory/intake/status")
async def intake_status(_: User = Depends(require_admin_or_manager)):
    return {"netbox": nbs.enabled(), "ai": intake.ai_enabled()}


@router.post("/inventory/intake/parse", response_model=ParsedInvoice,
             summary="Read an invoice with the configured AI model",
             description="Suggestions only — nothing is written. The supplier is matched to NetBox's "
                         "choice set and each line to an existing device type where confident.")
async def parse_invoice(file: UploadFile = File(...), db: AsyncSession = Depends(get_db),
                        user: User = Depends(require_admin_or_manager)):
    ext, content = await _read_document(file)
    try:
        parsed = await intake.parse_invoice(content, intake.INVOICE_TYPES[ext])
    except intake.IntakeError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
    await log_action(db, user, "inventory_intake_parsed", f"Invoice read by Gemini: {file.filename}")
    await db.commit()
    return parsed


@router.post("/inventory/intake", response_model=IntakeResult,
             summary="Receive equipment",
             description="Creates the devices in NetBox (asset tags come from NetBox's numbering hook), "
                         "attaches the invoice to each, and optionally logs the payment in Purchases.")
async def run_intake(
    file: UploadFile = File(...),
    payload: str = Form(...),
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin_or_manager),
):
    try:
        req = IntakeRequest.model_validate_json(payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if req.items and not nbs.enabled():
        raise _netbox_unavailable()
    ext, content = await _read_document(file)

    pay = req.payment
    if pay:
        # Validate the money side before NetBox is touched — it cannot be undone there.
        from app.models.models import Department, PaymentCard
        if pay.budget_id is not None:
            await get_or_404(db, Department, pay.budget_id)
        if pay.card_id is not None:
            await get_or_404(db, PaymentCard, pay.card_id)
        if pay.amount_aed is None and ps.to_aed(pay.amount, pay.currency) is None:
            raise HTTPException(status_code=422, detail=f"No exchange rate for {pay.currency} — enter the AED amount")

    devices, attachment, supplier, warnings, error = [], {}, req.supplier.strip(), [], None
    if req.items:
        try:
            devices, attachment, supplier, warnings, error = await intake.run_intake(req, content, ext)
        except (nbs.NetboxError, intake.IntakeError) as exc:
            # Failed before any device existed (supplier, type or upload step).
            raise HTTPException(status_code=exc.status_code, detail=str(exc))

    payment_id = None
    if pay and not error:
        from app.api.purchases import _INVOICE_DIR
        import uuid as _uuid
        tags = ", ".join(d.asset_tag or f"#{d.id}" for d in devices)
        p = PurchasePayment(
            paid_on=pay.paid_on,
            vendor=supplier,
            description=(pay.description or "; ".join(sorted({d.label for d in devices})))[:500] or None,
            category=pay.category or ("hardware" if devices else "other"),
            budget_id=pay.budget_id,
            payment_method=pay.payment_method or "card",
            card_id=pay.card_id if (pay.payment_method or "card") == "card" else None,
            amount=pay.amount,
            currency=pay.currency,
            amount_aed=pay.amount_aed if pay.amount_aed is not None else ps.to_aed(pay.amount, pay.currency),
            invoice_no=req.invoice_no,
            netbox_device_ids=json.dumps([d.id for d in devices]) if devices else None,
            status="confirmed",
            notes=f"Intake: {len(devices)} device(s) — asset tags {tags}" if devices else None,
            created_by=user.username,
        )
        db.add(p)
        await db.flush()
        _INVOICE_DIR.mkdir(parents=True, exist_ok=True)
        p.invoice_file = f"{p.id}-{_uuid.uuid4().hex[:12]}.{ext}"
        (_INVOICE_DIR / p.invoice_file).write_bytes(content)
        payment_id = p.id
    elif pay and error:
        warnings.append("Payment not logged because the intake stopped part-way — add it in Purchases "
                        "once the devices are complete")

    await log_action(
        db, user, "inventory_intake",
        f"Intake {supplier} #{req.invoice_no}: {len(devices)} device(s) "
        f"[{', '.join(str(d.id) for d in devices)}]"
        + (f", payment #{payment_id}" if payment_id else "")
        + (f"; ERROR: {error}" if error else ""),
    )
    await db.commit()
    logger.info("[tools] %s intake %s #%s: %d device(s)%s", user.username, supplier, req.invoice_no,
                len(devices), f" — stopped: {error}" if error else "")
    return IntakeResult(
        devices=devices,
        invoice_url=attachment.get("file"),
        payment_id=payment_id,
        supplier=supplier,
        warnings=warnings,
        error=error,
    )
