"""Container Dashboard API — VPS agent management and container monitoring."""
import hashlib
import json as _json
import logging
import secrets
import time
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.deps import get_current_user, require_admin
from app.models.models import (
    ContainerCommand, ContainerCommandStatus, ContainerState,
    TelegramTemplate, User, VPSAgent, utcnow,
)
from app.schemas.schemas import (
    AgentReportRequest, AgentReportResponse, AgentWithContainersResponse,
    CommandResultRequest, ContainerCommandCreate, ContainerCommandResponse,
    ContainerMetaUpdate, ContainerStateResponse, PendingCommandItem,
    SystemSnapshotResponse,
    VPSAgentCreate, VPSAgentRegisterResponse, VPSAgentResponse, VPSAgentUpdate,
)
from app.services.audit import log_action
from app.services.telegram_service import send_telegram_message

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/containers", tags=["containers"])

# ─── Per-agent rate limiters (separate buckets per endpoint type) ────────────
# cmd-handler polls /report every 5s; Telegraf flushes to /telegraf every 15s.
# A shared limiter causes cross-contamination, so each endpoint has its own dict.

_report_times:   dict[str, float] = {}   # /report + /command-result
_telegraf_times: dict[str, float] = {}   # /telegraf

REPORT_MIN_INTERVAL   = 3.0   # cmd-handler polls every 5s — allow every 3s
TELEGRAF_MIN_INTERVAL = 10.0  # Telegraf flushes every 15s — safe margin


async def get_agent(
    agent_id: UUID,
    x_agent_key: str = Header(..., alias="X-Agent-Key"),
    db: AsyncSession = Depends(get_db),
) -> VPSAgent:
    """Authenticate agent key only — no rate limiting (applied per endpoint)."""
    agent = await db.scalar(
        select(VPSAgent).where(VPSAgent.id == agent_id, VPSAgent.is_enabled == True)
    )
    if not agent:
        raise HTTPException(status_code=401, detail="Agent not found or disabled")
    if hashlib.sha256(x_agent_key.encode()).hexdigest() != agent.api_key_hash:
        raise HTTPException(status_code=401, detail="Invalid agent key")
    return agent


def _check_rate_limit(bucket: dict, agent_id: str, min_interval: float) -> None:
    now = time.monotonic()
    key = agent_id
    if now - bucket.get(key, 0) < min_interval:
        raise HTTPException(status_code=429, detail="Rate limit exceeded — report too frequent")
    bucket[key] = now


# ─── Telegram alert system ────────────────────────────────

# In-process dedup state — intentionally not persisted to DB.
# A server restart may produce one extra alert per agent; that is acceptable.
_alert_state: dict[str, dict] = {}

DISK_ALERT_COOLDOWN    = 3600       # 1 h between disk alerts
UPDATES_ALERT_COOLDOWN = 86400      # 24 h between update-nag alerts

BAD_STATUSES = {"exited", "dead", "oom_killed"}


def _get_alert_state(agent_id: str) -> dict:
    if agent_id not in _alert_state:
        _alert_state[agent_id] = {
            "disk_alerted_at":      0.0,
            "last_login_key":       None,   # "username@ip" of most-recent login last seen
            "updates_alerted_at":   0.0,
            "updates_count_last":   -1,
        }
    return _alert_state[agent_id]


def _fmt_bytes(b: int) -> str:
    if b < 1024 ** 2: return f"{b / 1024:.0f} KB"
    if b < 1024 ** 3: return f"{b / 1024**2:.0f} MB"
    return f"{b / 1024**3:.1f} GB"


async def _tg(tpl: TelegramTemplate, msg: str, agent_name: str) -> None:
    topic = str(tpl.topic_id) if tpl.topic_id else None
    try:
        await send_telegram_message(tpl.chat_id, msg, topic)
    except Exception as exc:
        logger.warning("Telegram alert failed for agent %s: %s", agent_name, exc)


async def _check_alerts(db: AsyncSession, agent: VPSAgent, snapshot: dict) -> None:
    """
    Evaluate disk / login / update thresholds and fire Telegram alerts when needed.
    snapshot keys: system, recent_logins, pending_updates, failed_services
    """
    if not agent.alert_template_id:
        return

    tpl = await db.get(TelegramTemplate, agent.alert_template_id)
    if not tpl:
        return

    now   = time.monotonic()
    state = _get_alert_state(str(agent.id))
    host  = f"\nHost: <code>{agent.hostname}</code>" if agent.hostname else ""

    # ── 1. Disk space low ────────────────────────────────
    sys = snapshot.get("system") or {}
    disk_used  = int(sys.get("disk_used_bytes")  or 0)
    disk_total = int(sys.get("disk_total_bytes") or 0)
    threshold  = int(getattr(agent, "disk_alert_threshold", None) or 85)

    if disk_total > 0:
        disk_pct = (disk_used / disk_total) * 100
        if disk_pct >= threshold and (now - state["disk_alerted_at"]) > DISK_ALERT_COOLDOWN:
            state["disk_alerted_at"] = now
            await _tg(tpl, (
                f"⚠️ <b>Disk space low</b> — <b>{agent.name}</b>\n"
                f"Used: <b>{disk_pct:.0f}%</b>  ({_fmt_bytes(disk_used)} / {_fmt_bytes(disk_total)})\n"
                f"Alert threshold: {threshold}%{host}"
            ), agent.name)

    # ── 2. New SSH login detected ────────────────────────
    logins = snapshot.get("recent_logins") or []
    if logins:
        first     = logins[0]
        username  = str(first.get("username") or "unknown")
        ip        = str(first.get("ip") or "")
        login_key = f"{username}@{ip or 'local'}"

        # Only alert if we have a previous baseline (avoids alerting on first ever report)
        if state["last_login_key"] is not None and login_key != state["last_login_key"]:
            ts = str(first.get("timestamp") or "")
            await _tg(tpl, (
                f"👤 <b>New login</b> — <b>{agent.name}</b>\n"
                f"User: <code>{username}</code>\n"
                f"From: <code>{ip or 'local/console'}</code>"
                + (f"\nTime: {ts}" if ts else "")
                + host
            ), agent.name)

        state["last_login_key"] = login_key

    # ── 3. Pending OS updates ────────────────────────────
    updates      = snapshot.get("pending_updates") or []
    update_count = len(updates)
    updates_cooldown_expired = (now - state["updates_alerted_at"]) > UPDATES_ALERT_COOLDOWN
    count_changed = update_count != state["updates_count_last"]

    if update_count > 0 and updates_cooldown_expired and count_changed:
        state["updates_alerted_at"]   = now
        state["updates_count_last"]   = update_count

        lines = ""
        for u in updates[:5]:
            pkg  = u.get("package", "?")
            cur  = u.get("current_version", "")
            new  = u.get("new_version", "")
            lines += f"\n• {pkg}" + (f": {cur} → <b>{new}</b>" if cur and new else "")
        if update_count > 5:
            lines += f"\n• … and {update_count - 5} more"

        await _tg(tpl, (
            f"⬆️ <b>Updates available</b> — <b>{agent.name}</b>\n"
            f"<b>{update_count}</b> package{'s' if update_count != 1 else ''} pending:{lines}{host}"
        ), agent.name)


async def _maybe_container_alert(db, agent, cs, old_status: str, new_status: str) -> None:
    """Alert when a running container transitions to an error state."""
    if old_status.lower() == "running" and new_status.lower() in BAD_STATUSES:
        if not agent.alert_template_id:
            return
        tpl = await db.get(TelegramTemplate, agent.alert_template_id)
        if not tpl:
            return
        label = cs.display_name or cs.name
        host  = f"\nHost: <code>{agent.hostname}</code>" if agent.hostname else ""
        await _tg(tpl, (
            f"🚨 <b>Container alert</b> — <b>{agent.name}</b>\n"
            f"<code>{label}</code>: <code>{old_status}</code> → <code>{new_status}</code>\n"
            f"Image: <code>{cs.image}</code>{host}"
        ), agent.name)


# ─── Shared persistence helpers ───────────────────────────

async def _upsert_containers(
    db: AsyncSession,
    agent_id: UUID,
    agent: VPSAgent,
    containers: list[dict],
) -> None:
    """Upsert container list. Never overwrites user-editable metadata."""
    incoming_ids: set[str] = set()

    for ci in containers:
        docker_id = (ci.get("docker_id") or "").strip()
        name      = (ci.get("name")      or "unknown").strip()
        image     = (ci.get("image")     or "").strip()
        status    = (ci.get("status")    or "unknown").lower()
        if not docker_id:
            continue
        incoming_ids.add(docker_id)

        existing = await db.scalar(
            select(ContainerState).where(
                ContainerState.agent_id == agent_id,
                ContainerState.docker_id == docker_id,
            )
        )
        if existing:
            old_status      = existing.status
            existing.name   = name
            existing.image  = image
            existing.status = status
            if ci.get("state_detail")   is not None: existing.state_detail   = _json.dumps(ci["state_detail"])
            if ci.get("ports")          is not None: existing.ports          = _json.dumps(ci["ports"])
            if ci.get("cpu_percent")    is not None: existing.cpu_percent    = ci["cpu_percent"]
            if ci.get("mem_usage_bytes") is not None: existing.mem_usage_bytes = ci["mem_usage_bytes"]
            if ci.get("mem_limit_bytes") is not None: existing.mem_limit_bytes = ci["mem_limit_bytes"]
            if ci.get("last_logs")      is not None: existing.last_logs      = _json.dumps(ci["last_logs"])
            existing.reported_at = utcnow()
            existing.is_absent   = False
            await _maybe_container_alert(db, agent, existing, old_status, status)
        else:
            db.add(ContainerState(
                agent_id=agent_id, docker_id=docker_id, name=name, image=image, status=status,
                state_detail=_json.dumps(ci["state_detail"]) if ci.get("state_detail") else None,
                ports=_json.dumps(ci["ports"])               if ci.get("ports")        else None,
                cpu_percent=ci.get("cpu_percent"),
                mem_usage_bytes=ci.get("mem_usage_bytes"),
                mem_limit_bytes=ci.get("mem_limit_bytes"),
                last_logs=_json.dumps(ci["last_logs"])        if ci.get("last_logs")   else None,
            ))

    if incoming_ids:
        await db.execute(
            update(ContainerState)
            .where(ContainerState.agent_id == agent_id,
                   ContainerState.docker_id.notin_(incoming_ids))
            .values(is_absent=True)
        )
    else:
        await db.execute(
            update(ContainerState).where(ContainerState.agent_id == agent_id).values(is_absent=True)
        )


async def _claim_pending_commands(db: AsyncSession, agent_id: UUID) -> list:
    result = await db.execute(
        select(ContainerCommand).where(
            ContainerCommand.agent_id == agent_id,
            ContainerCommand.status == ContainerCommandStatus.PENDING,
        )
    )
    pending = result.scalars().all()
    for cmd in pending:
        cmd.status = ContainerCommandStatus.EXECUTING
    return pending


# ─── Telegraf batch parser ────────────────────────────────

def _parse_telegraf_batch(raw: Any) -> dict:
    """
    Parse a Telegraf outputs.http JSON batch (use_batch_format = true) into our
    internal structure.  Handles both {"metrics": [...]} and bare [...] formats.
    """
    if isinstance(raw, dict):
        metrics: list = raw.get("metrics", [raw])
    elif isinstance(raw, list):
        metrics = raw
    else:
        return {}

    containers: dict[str, dict] = {}
    sys_data:   dict = {}
    updates:    list = []
    failed:     list = []
    logins:     list = []
    hostname:   str | None = None

    for m in metrics:
        if not isinstance(m, dict):
            continue
        name   = m.get("name", "")
        tags   = m.get("tags") or {}
        fields = m.get("fields") or {}

        if not hostname:
            hostname = tags.get("host") or tags.get("hostname")

        if name == "cpu" and tags.get("cpu") == "cpu-total":
            sys_data["cpu_percent"] = round(100.0 - float(fields.get("usage_idle", 0) or 0), 1)

        elif name == "mem":
            sys_data["mem_used_bytes"]  = int(fields.get("used",  0) or 0)
            sys_data["mem_total_bytes"] = int(fields.get("total", 0) or 0)

        elif name == "disk" and tags.get("path") == "/":
            sys_data["disk_used_bytes"]  = int(fields.get("used",  0) or 0)
            sys_data["disk_total_bytes"] = int(fields.get("total", 0) or 0)

        elif name == "system":
            sys_data["load_avg_1m"]    = float(fields.get("load1",  0) or 0)
            sys_data["load_avg_5m"]    = float(fields.get("load5",  0) or 0)
            sys_data["uptime_seconds"] = int(fields.get("uptime",   0) or 0)

        elif name == "docker_container_status":
            cid = (tags.get("container_id") or "")[:12]
            if cid:
                c = containers.setdefault(cid, {"docker_id": cid})
                c["name"]   = (tags.get("container_name")  or "unknown").lstrip("/")
                c["image"]  = tags.get("container_image")  or ""
                c["status"] = (tags.get("container_status") or "unknown").lower()

        elif name == "docker_container_cpu" and tags.get("cpu") == "cpu-total":
            cid = (tags.get("container_id") or "")[:12]
            if cid:
                containers.setdefault(cid, {"docker_id": cid})["cpu_percent"] = (
                    round(float(fields.get("usage_percent", 0) or 0), 2)
                )

        elif name == "docker_container_mem":
            cid = (tags.get("container_id") or "")[:12]
            if cid:
                c = containers.setdefault(cid, {"docker_id": cid})
                c["mem_usage_bytes"] = int(fields.get("usage", 0) or 0)
                c["mem_limit_bytes"] = int(fields.get("limit", 0) or 0)

        elif name == "apt_updates":
            try:    updates = _json.loads(str(fields.get("value", "[]")))
            except Exception: pass

        elif name == "systemd_failed":
            val = str(fields.get("value", "")).strip()
            if val:
                failed = [s.strip() for s in val.split(",") if s.strip()]

        elif name == "recent_logins":
            try:    logins = _json.loads(str(fields.get("value", "[]")))
            except Exception: pass

    return {
        "hostname":        hostname,
        "containers":      list(containers.values()),
        "system":          sys_data or None,
        "pending_updates": updates,
        "failed_services": failed,
        "recent_logins":   logins,
    }


# ─── Agent report endpoints ───────────────────────────────

@router.post("/agents/{agent_id}/report", response_model=AgentReportResponse)
async def agent_report(
    agent_id: UUID,
    body: AgentReportRequest,
    agent: VPSAgent = Depends(get_agent),
    db: AsyncSession = Depends(get_db),
):
    """Generic push endpoint — structured JSON format."""
    _check_rate_limit(_report_times, str(agent_id), REPORT_MIN_INTERVAL)
    agent.last_seen = utcnow()
    if body.ip_address: agent.ip_address = body.ip_address
    if body.hostname:   agent.hostname   = body.hostname

    snapshot = {
        "system":          body.system.model_dump() if body.system else None,
        "recent_logins":   [l.model_dump() for l in body.recent_logins]   if body.recent_logins   else [],
        "pending_updates": [u.model_dump() for u in body.pending_updates] if body.pending_updates else [],
        "failed_services": body.failed_services or [],
    }
    if any(snapshot.values()):
        agent.system_snapshot = _json.dumps({**snapshot, "snapshot_at": utcnow().isoformat()})
        await _check_alerts(db, agent, snapshot)

    containers = [
        {
            "docker_id": c.docker_id, "name": c.name, "image": c.image, "status": c.status,
            "state_detail": c.state_detail, "ports": c.ports,
            "cpu_percent": c.cpu_percent, "mem_usage_bytes": c.mem_usage_bytes,
            "mem_limit_bytes": c.mem_limit_bytes, "last_logs": c.logs,
        }
        for c in body.containers
    ]
    await _upsert_containers(db, agent_id, agent, containers)
    pending = await _claim_pending_commands(db, agent_id)
    return AgentReportResponse(
        pending_commands=[
            PendingCommandItem(id=c.id, docker_id=c.docker_id,
                               container_name=c.container_name, command=c.command)
            for c in pending
        ]
    )


@router.post("/agents/{agent_id}/telegraf", response_model=AgentReportResponse)
async def telegraf_report(
    agent_id: UUID,
    request: Request,
    agent: VPSAgent = Depends(get_agent),
    db: AsyncSession = Depends(get_db),
):
    """
    Telegraf outputs.http endpoint.
    Config:  data_format = "json"  +  use_batch_format = true
    Header:  X-Agent-Key = "<key>"
    """
    _check_rate_limit(_telegraf_times, str(agent_id), TELEGRAF_MIN_INTERVAL)
    try:
        raw = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    parsed = _parse_telegraf_batch(raw)
    if not parsed:
        raise HTTPException(status_code=400, detail="Could not parse Telegraf batch")

    agent.last_seen = utcnow()
    if parsed.get("hostname"): agent.hostname = parsed["hostname"]

    snapshot = {
        "system":          parsed.get("system"),
        "recent_logins":   parsed.get("recent_logins",   []),
        "pending_updates": parsed.get("pending_updates", []),
        "failed_services": parsed.get("failed_services", []),
    }
    if any(snapshot.values()):
        agent.system_snapshot = _json.dumps({**snapshot, "snapshot_at": utcnow().isoformat()})
        await _check_alerts(db, agent, snapshot)

    await _upsert_containers(db, agent_id, agent, parsed.get("containers", []))
    pending = await _claim_pending_commands(db, agent_id)
    return AgentReportResponse(
        pending_commands=[
            PendingCommandItem(id=c.id, docker_id=c.docker_id,
                               container_name=c.container_name, command=c.command)
            for c in pending
        ]
    )


@router.post("/agents/{agent_id}/commands/{cmd_id}/result")
async def agent_command_result(
    agent_id: UUID, cmd_id: UUID, body: CommandResultRequest,
    agent: VPSAgent = Depends(get_agent), db: AsyncSession = Depends(get_db),
):
    cmd = await db.scalar(
        select(ContainerCommand).where(
            ContainerCommand.id == cmd_id, ContainerCommand.agent_id == agent_id,
        )
    )
    if not cmd:
        raise HTTPException(status_code=404, detail="Command not found")
    cmd.status = body.status
    cmd.executed_at = utcnow()
    cmd.result_message = body.result_message
    return {"ok": True}


# ─── Admin management endpoints ───────────────────────────

@router.post("/agents", response_model=VPSAgentRegisterResponse)
async def register_agent(
    req: VPSAgentCreate, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    """Register a new VPS agent. Returns the API key exactly once."""
    existing = await db.scalar(select(VPSAgent).where(VPSAgent.name == req.name))
    if existing:
        raise HTTPException(status_code=409, detail="Agent name already exists")
    raw_key  = secrets.token_hex(32)
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    agent = VPSAgent(
        name=req.name, description=req.description,
        alert_template_id=req.alert_template_id,
        disk_alert_threshold=req.disk_alert_threshold,
        api_key_hash=key_hash,
    )
    db.add(agent)
    await db.flush()
    await log_action(db, admin, "container_agent_register", f"Registered VPS agent: {req.name}")
    await db.commit()
    await db.refresh(agent)
    resp = VPSAgentRegisterResponse.model_validate(agent)
    resp.api_key = raw_key
    return resp


@router.get("/agents", response_model=list[VPSAgentResponse])
async def list_agents(admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(VPSAgent).order_by(VPSAgent.name))
    return [VPSAgentResponse.model_validate(a) for a in result.scalars().all()]


@router.patch("/agents/{agent_id}", response_model=VPSAgentResponse)
async def update_agent(
    agent_id: UUID, req: VPSAgentUpdate,
    admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    agent = await db.get(VPSAgent, agent_id)
    if not agent:
        raise HTTPException(status_code=404)
    for field, value in req.model_dump(exclude_unset=True).items():
        setattr(agent, field, value)
    await db.flush()
    await log_action(db, admin, "container_agent_update", f"Updated VPS agent: {agent.name}")
    await db.commit()
    await db.refresh(agent)
    return VPSAgentResponse.model_validate(agent)


@router.delete("/agents/{agent_id}")
async def delete_agent(
    agent_id: UUID, admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db),
):
    agent = await db.get(VPSAgent, agent_id)
    if not agent:
        raise HTTPException(status_code=404)
    name = agent.name
    await db.delete(agent)
    await log_action(db, admin, "container_agent_delete", f"Deleted VPS agent: {name}")
    await db.commit()
    return {"deleted": True}


@router.get("/commands", response_model=list[ContainerCommandResponse])
async def list_commands(admin: User = Depends(require_admin), db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(ContainerCommand).order_by(ContainerCommand.issued_at.desc()).limit(100)
    )
    return [ContainerCommandResponse.model_validate(c) for c in result.scalars().all()]


# ─── User dashboard endpoints ─────────────────────────────

@router.get("/", response_model=list[AgentWithContainersResponse])
async def get_dashboard(
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(VPSAgent)
        .where(VPSAgent.is_enabled == True)
        .options(selectinload(VPSAgent.containers))
        .order_by(VPSAgent.name)
    )
    agents = result.scalars().all()
    from datetime import timezone as _tz
    now = utcnow()
    out = []
    for agent in agents:
        if agent.last_seen is None:
            online = False
        else:
            ls = agent.last_seen if agent.last_seen.tzinfo else agent.last_seen.replace(tzinfo=_tz.utc)
            online = (now - ls).total_seconds() < 75
        containers = [ContainerStateResponse.model_validate(c) for c in agent.containers if not c.is_absent]
        snapshot = None
        if agent.system_snapshot:
            try:
                snapshot = SystemSnapshotResponse(**_json.loads(agent.system_snapshot))
            except Exception:
                pass
        resp = AgentWithContainersResponse.model_validate(agent)
        resp.online     = online
        resp.containers = containers
        resp.snapshot   = snapshot
        out.append(resp)
    out.sort(key=lambda a: (0 if a.online else 1, a.name))
    return out


@router.post("/agents/{agent_id}/containers/{docker_id}/action", response_model=ContainerCommandResponse)
async def queue_container_action(
    agent_id: UUID, docker_id: str, body: ContainerCommandCreate,
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    agent = await db.scalar(select(VPSAgent).where(VPSAgent.id == agent_id, VPSAgent.is_enabled == True))
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    cs = await db.scalar(
        select(ContainerState).where(
            ContainerState.agent_id == agent_id, ContainerState.docker_id == docker_id,
            ContainerState.is_absent == False,
        )
    )
    if not cs:
        raise HTTPException(status_code=404, detail="Container not found")
    existing = await db.scalar(
        select(ContainerCommand).where(
            ContainerCommand.agent_id == agent_id, ContainerCommand.docker_id == docker_id,
            ContainerCommand.status.in_([ContainerCommandStatus.PENDING, ContainerCommandStatus.EXECUTING]),
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="Command already pending for this container")
    cmd = ContainerCommand(
        agent_id=agent_id, docker_id=docker_id, container_name=cs.display_name or cs.name,
        command=body.command, issued_by_user_id=user.id,
    )
    db.add(cmd)
    await db.flush()
    await log_action(db, user, "container_action",
                     f"Queued {body.command} on '{cs.display_name or cs.name}' @ agent '{agent.name}'")
    return ContainerCommandResponse.model_validate(cmd)


@router.patch("/agents/{agent_id}/containers/{docker_id}", response_model=ContainerStateResponse)
async def update_container_meta(
    agent_id: UUID, docker_id: str, body: ContainerMetaUpdate,
    user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db),
):
    cs = await db.scalar(
        select(ContainerState).where(
            ContainerState.agent_id == agent_id, ContainerState.docker_id == docker_id,
        )
    )
    if not cs:
        raise HTTPException(status_code=404, detail="Container not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(cs, field, value)
    await db.flush()
    agent = await db.get(VPSAgent, agent_id)
    await log_action(db, user, "container_meta_update",
                     f"Updated metadata for '{cs.name}' @ agent '{agent.name if agent else agent_id}'")
    return ContainerStateResponse.model_validate(cs)
