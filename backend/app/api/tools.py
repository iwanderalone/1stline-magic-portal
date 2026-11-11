"""Tools API — utilities for engineers. Currently: Mailbox Backup, Inventory
(NetBox), Handover generator.

POST /tools/mailbox-backup        start backup jobs: employee logins × mail/Disk
GET  /tools/mailbox-backup/jobs   paginated jobs, active ones pinned first
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
    HandoverUndone,
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
from app.services import yandex360 as y360
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
    return {"mailbox_backup": mbs.enabled() and y360.enabled(), "netbox": nbs.enabled()}


@router.post("/mailbox-backup", response_model=list[MailboxBackupJobResponse], status_code=201)
async def start_mailbox_backup(
    payload: MailboxBackupBatchStart,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
):
    """Start one or more backup jobs — mail, Disk or both per employee, each its
    own job and archive. Jobs run sequentially (one pipeline at a time). The
    Yandex 360 service application signs in as the employee; logins are checked
    against the directory here, so a typo is refused now rather than failing
    later in the queue. A blocked account is unblocked for the backup and
    blocked again once its jobs end; `block_after` also blocks an active one
    after a fully successful backup."""
    if not (mbs.enabled() and y360.enabled()):
        raise HTTPException(status_code=503, detail="Backup is not configured")
    kinds = [k for k, on in (("mail", payload.mail), ("disk", payload.disk)) if on]
    if not kinds:
        raise HTTPException(status_code=400, detail="Choose what to back up: mail, Disk or both")

    people: dict[str, dict] = {}           # email → directory entry; a login and its address are one person
    problems = []
    for login in dict.fromkeys(x.strip().lower() for x in payload.logins if x.strip()):
        try:
            u = await asyncio.to_thread(y360.find_user, login, True)
            people.setdefault(u["email"].lower(), u)
        except y360.Yandex360Error as e:
            problems.append(str(e))
    if problems:
        raise HTTPException(status_code=400, detail="; ".join(problems))
    if not people:
        raise HTTPException(status_code=400, detail="Enter at least one login")
    emails = list(people)
    busy = [f"{e} ({k})" for e in emails for k in kinds if mbs.is_busy(e, k)]
    if busy:
        raise HTTPException(status_code=409, detail=f"Backup already running/queued for: {', '.join(busy)}")

    # A blocked account can't be read — unblock it now; it is blocked again
    # when its jobs end (whatever their outcome, see mbs.account_decision).
    blocked = [e for e in emails if people[e].get("isEnabled") is False]
    unblocked: list[str] = []
    try:
        for e in blocked:
            await asyncio.to_thread(y360.set_enabled, people[e]["id"], True)
            unblocked.append(e)
    except y360.Yandex360Error as exc:
        for e in unblocked:            # roll back: nothing is queued for them
            try:
                await asyncio.to_thread(y360.set_enabled, people[e]["id"], False)
            except y360.Yandex360Error:
                logger.exception("[tools] could not re-block %s after a failed batch start", e)
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    action = {e: "restore" if e in blocked else ("block" if payload.block_after else None) for e in emails}

    planned = [(email, kind) for email in emails for kind in kinds]
    jobs: list[MailboxBackupJob] = []
    for email, kind in planned:
        job = MailboxBackupJob(
            email=email,
            kind=kind,
            requested_by=user.display_name or user.username,
            status="queued",
            account_action=action[email],
        )
        db.add(job)
        jobs.append(job)
    await log_action(db, user, "mailbox_backup_started",
                     f"Backup ({' + '.join(kinds)}) started for {len(emails)} employee(s): {', '.join(emails)}"
                     + (f"; unblocked for the backup: {', '.join(blocked)}" if blocked else "")
                     + ("; block after a successful backup" if payload.block_after else ""))
    await db.commit()
    for job in jobs:
        await db.refresh(job)
    for email in emails:
        if action[email]:
            mbs.plan_account(email, str(people[email]["id"]), action[email],
                             [j.id for j, (e, _) in zip(jobs, planned) if e == email])

    # Fire-and-forget: pipelines run in worker threads, serialized by a global lock (FIFO).
    for job, (email, kind) in zip(jobs, planned):
        asyncio.create_task(mbs.run_backup_job(job.id, email, kind))
    logger.info("[tools] %s started %d backup job(s) (%s): %s",
                user.username, len(jobs), "+".join(kinds), ", ".join(emails))
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


@router.delete("/inventory/handovers/{record_id}", response_model=HandoverUndone,
               summary="Cancel a handover recorded by mistake",
               description="Only while it waits for signature: deletes its contact-assignments and "
                           "the draft document in NetBox, so the devices are free to hand over again. "
                           "Returns who and what it was, for the form to refill.")
async def cancel_handover(
    record_id: int,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_admin_or_manager),
):
    if not nbs.enabled():
        raise _netbox_unavailable()
    record = await get_or_404(db, HandoverRecord, record_id)
    if record.status != "pending":
        raise HTTPException(status_code=409, detail="The signed copy is already attached — change it in NetBox")
    assignment_ids = json.loads(record.assignment_ids or "[]")
    devices = json.loads(record.devices or "[]")
    signed_by_id = None
    try:
        if assignment_ids:
            try:
                signed_by_id = ((await nbs.get_assignment(assignment_ids[0])).get("signed_by") or {}).get("id")
            except nbs.NetboxNotFoundError:
                pass
        for assignment_id in assignment_ids:
            await nbs.delete_assignment(assignment_id)
    except nbs.NetboxError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc))
    if record.draft_attachment_id:
        # The holder is what matters; an orphaned draft is harmless, so don't fail on it.
        try:
            await nbs.delete_attachment(record.draft_attachment_id)
        except nbs.NetboxError as exc:
            logger.warning("[tools] handover #%s: draft attachment #%s not deleted: %s",
                           record.id, record.draft_attachment_id, exc)
    undone = HandoverUndone(
        employee_contact_id=record.employee_contact_id,
        signed_by_contact_id=signed_by_id,
        device_ids=[d["id"] for d in devices],
    )
    await log_action(db, user, "inventory_handover_cancelled",
                     f"Handover for {record.employee_name} cancelled (#{record.id}, "
                     f"{len(assignment_ids)} assignment(s) removed from NetBox)")
    await db.delete(record)
    await db.commit()
    return undone


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


@router.post("/inventory/intake/split",
             summary="Cut a PDF that holds several invoices into one PDF per invoice",
             description="`parts` is empty when the file is a single invoice (or not a PDF) — use it as is.")
async def split_invoice_file(file: UploadFile = File(...), _: User = Depends(require_admin_or_manager)):
    import base64
    ext, content = await _read_document(file)
    if ext != "pdf":
        return {"parts": []}
    parts = await asyncio.to_thread(intake.split_invoices, content)
    if len(parts) < 2:
        return {"parts": []}
    stem = (file.filename or "invoice").rsplit(".", 1)[0][:80]
    return {"parts": [
        {"name": f"{stem} - {number or i + 1}.pdf".replace("/", "-"), "invoice_no": number,
         "data": base64.b64encode(data).decode()}
        for i, (number, data) in enumerate(parts)
    ]}


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
    # Money side: which subscriptions the lines pay, and whether this invoice
    # number is in the log already. Suggestions — the form shows and edits them.
    from app.models.models import Subscription
    subs = (await db.execute(select(Subscription).where(Subscription.status == "active"))).unique().scalars().all()
    supplier = parsed.supplier_raw or parsed.supplier
    for item in parsed.items:
        if item.is_device:
            continue
        item.subscription_ids = ps.match_subscriptions(
            subs, supplier, " ".join(filter(None, [item.description, item.model])),
            reference=item.reference, period_start=item.period_start, quantity=item.quantity,
        )
    parsed.logged_payment_ids = [p.id for p in await ps.invoice_already_logged(db, supplier, parsed.invoice_no)]
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
        logged = await ps.invoice_already_logged(db, req.supplier, req.invoice_no)
        if logged:
            raise HTTPException(
                status_code=409,
                detail=f"Invoice #{req.invoice_no} from {logged[0].vendor} is already in the payment log "
                       f"(payment #{logged[0].id}, {logged[0].paid_on}) — delete that one first to re-enter it",
            )
        from app.models.models import Subscription
        split_subs = {}
        for sp in pay.splits:
            if sp.subscription_id not in split_subs:
                split_subs[sp.subscription_id] = await get_or_404(db, Subscription, sp.subscription_id)

    devices, attachment, supplier, warnings, error = [], {}, req.supplier.strip(), [], None
    if req.items:
        try:
            devices, attachment, supplier, warnings, error = await intake.run_intake(req, content, ext)
        except (nbs.NetboxError, intake.IntakeError) as exc:
            # Failed before any device existed (supplier, type or upload step).
            raise HTTPException(status_code=exc.status_code, detail=str(exc))

    payment_ids: list[int] = []
    confirmed_expected = 0
    if pay and not error:
        from app.api.purchases import _INVOICE_DIR
        import uuid as _uuid
        method = pay.payment_method or "card"
        total_aed = pay.amount_aed if pay.amount_aed is not None else ps.to_aed(pay.amount, pay.currency)
        rate = total_aed / pay.amount if pay.amount else 0
        booked: list[PurchasePayment] = []
        left, left_aed = pay.amount, total_aed

        # Lines that pay a subscription settle its period (confirming the
        # expected payment when the job already generated one).
        for i, sp in enumerate(pay.splits):
            amount = sp.amount
            if i == len(pay.splits) - 1 and abs(left - amount) <= 0.05:
                amount = round(left, 2)          # rounding crumbs stay with the last line
            aed = round(left_aed, 2) if amount == round(left, 2) else round(amount * rate, 2)
            p, merged = await ps.settle_invoice(
                db, split_subs[sp.subscription_id],
                paid_on=pay.paid_on, amount=amount, currency=pay.currency, amount_aed=aed,
                invoice_no=req.invoice_no, created_by=user.username,
                period_start=sp.period_start, period_end=sp.period_end, one_time=bool(sp.one_time),
                description=sp.description, supplier=supplier,
                budget_id=pay.budget_id, card_id=pay.card_id, payment_method=pay.payment_method,
            )
            confirmed_expected += merged
            booked.append(p)
            left, left_aed = left - amount, left_aed - aed

        # The rest of the invoice (or all of it) is a payment of its own.
        if left > 0.05 or not booked:
            tags = ", ".join(d.asset_tag or f"#{d.id}" for d in devices)
            p = PurchasePayment(
                paid_on=pay.paid_on,
                vendor=supplier,
                description=(pay.description or "; ".join(sorted({d.label for d in devices})))[:500] or None,
                category=pay.category or ("hardware" if devices else "other"),
                budget_id=pay.budget_id,
                payment_method=method,
                card_id=pay.card_id if method == "card" else None,
                amount=round(max(left, 0), 2),
                currency=pay.currency,
                amount_aed=round(max(left_aed, 0), 2),
                invoice_no=req.invoice_no,
                netbox_device_ids=json.dumps([d.id for d in devices]) if devices else None,
                status="confirmed",
                notes=f"Intake: {len(devices)} device(s) — asset tags {tags}" if devices else None,
                created_by=user.username,
            )
            db.add(p)
            booked.append(p)

        await db.flush()
        _INVOICE_DIR.mkdir(parents=True, exist_ok=True)
        for p in booked:
            # One copy per payment: deleting or re-attaching on one row must
            # never take the invoice away from the others.
            if p.invoice_file:
                (_INVOICE_DIR / p.invoice_file).unlink(missing_ok=True)
            p.invoice_file = f"{p.id}-{_uuid.uuid4().hex[:12]}.{ext}"
            (_INVOICE_DIR / p.invoice_file).write_bytes(content)
        payment_ids = [p.id for p in booked]
    elif pay and error:
        warnings.append("Payment not logged because the intake stopped part-way — add it in Purchases "
                        "once the devices are complete")

    await log_action(
        db, user, "inventory_intake",
        f"Intake {supplier} #{req.invoice_no}: {len(devices)} device(s) "
        f"[{', '.join(str(d.id) for d in devices)}]"
        + (f", payment(s) {', '.join(f'#{i}' for i in payment_ids)}" if payment_ids else "")
        + (f", {confirmed_expected} expected confirmed" if confirmed_expected else "")
        + (f"; ERROR: {error}" if error else ""),
    )
    await db.commit()
    logger.info("[tools] %s intake %s #%s: %d device(s)%s", user.username, supplier, req.invoice_no,
                len(devices), f" — stopped: {error}" if error else "")
    return IntakeResult(
        devices=devices,
        invoice_url=attachment.get("file"),
        payment_id=payment_ids[0] if payment_ids else None,
        payment_ids=payment_ids,
        confirmed_expected=confirmed_expected,
        supplier=supplier,
        warnings=warnings,
        error=error,
    )
