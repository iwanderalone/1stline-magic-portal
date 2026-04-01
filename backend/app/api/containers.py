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
from app.core.deps import get_current_user, require_admin, get_or_404
from app.models.models import (
    ContainerState,
    TelegramTemplate, User, VPSAgent, utcnow,
)
from app.schemas.schemas import (
    AgentReportRequest, AgentReportResponse, AgentWithContainersResponse,
    ContainerMetaUpdate, ContainerStateResponse,
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

_report_times:   dict[str, float] = {}   # /report
_telegraf_times: dict[str, float] = {}   # /telegraf

REPORT_MIN_INTERVAL   = 3.0   # allow at most one report every 3s
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

# Agents currently considered offline (by the offline-checker job).
# When the agent reports back in, _check_alerts clears this and sends recovery.
_offline_agents: set[str] = set()

DISK_ALERT_COOLDOWN    = 3600       # 1 h between disk alerts
CPU_ALERT_COOLDOWN     = 1800       # 30 min between CPU spike alerts
CPU_HIGH_COUNT_TRIGGER = 3          # fire after N consecutive high-CPU reports (~45 s at 15 s interval)
UPDATES_ALERT_COOLDOWN = 86400      # 24 h between update-nag alerts
OFFLINE_THRESHOLD_S    = 300        # 5 min without heartbeat = offline
OFFLINE_ALERT_COOLDOWN = 3600       # 1 h between repeated offline alerts

BAD_STATUSES = {"exited", "dead", "oom_killed"}


def _get_alert_state(agent_id: str) -> dict:
    if agent_id not in _alert_state:
        _alert_state[agent_id] = {
            "disk_alerted_at":    0.0,
            "seen_login_ids":     None,   # set of session_id strings; None = not yet initialised
            "updates_alerted_at": 0.0,
            "updates_count_last": -1,
            "cpu_high_count":     0,      # consecutive reports above threshold
            "cpu_alerted_at":     0.0,
            "offline_alerted_at": 0.0,
        }
    return _alert_state[agent_id]


def _flag(agent: VPSAgent, key: str) -> bool:
    """Return True if an alert type is enabled for this agent (default True when unset)."""
    flags = getattr(agent, "alert_flags", None)
    if not flags:
        return True
    return bool(flags.get(key, True))


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
    Evaluate disk / cpu / login / update thresholds and fire Telegram alerts when needed.
    Also clears the offline flag and sends a recovery message if the agent was offline.
    snapshot keys: system, recent_logins, pending_updates, failed_services
    """
    agent_id_str = str(agent.id)
    state = _get_alert_state(agent_id_str)

    # ── Recovery: agent is back online after being flagged offline ───────────
    if agent_id_str in _offline_agents:
        _offline_agents.discard(agent_id_str)
        state["offline_alerted_at"] = 0.0
        if agent.alert_template_id:
            tpl = await db.get(TelegramTemplate, agent.alert_template_id)
            if tpl and _flag(agent, "offline"):
                host = f"\nHost: <code>{agent.hostname}</code>" if agent.hostname else ""
                await _tg(tpl, f"✅ <b>VPS back online</b> — <b>{agent.name}</b>{host}", agent.name)

    if not agent.alert_template_id:
        return

    tpl = await db.get(TelegramTemplate, agent.alert_template_id)
    if not tpl:
        return

    now  = time.monotonic()
    host = f"\nHost: <code>{agent.hostname}</code>" if agent.hostname else ""
    sys  = snapshot.get("system") or {}

    # ── 1. Disk space low ────────────────────────────────
    if _flag(agent, "disk"):
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

    # ── 2. CPU spike ─────────────────────────────────────
    if _flag(agent, "cpu"):
        cpu_pct   = sys.get("cpu_percent")
        cpu_thresh = int(getattr(agent, "cpu_alert_threshold", None) or 80)
        if cpu_pct is not None:
            if cpu_pct >= cpu_thresh:
                state["cpu_high_count"] += 1
            else:
                state["cpu_high_count"] = 0
            if state["cpu_high_count"] >= CPU_HIGH_COUNT_TRIGGER and (now - state["cpu_alerted_at"]) > CPU_ALERT_COOLDOWN:
                state["cpu_alerted_at"] = now
                state["cpu_high_count"] = 0
                await _tg(tpl, (
                    f"🔥 <b>CPU spike</b> — <b>{agent.name}</b>\n"
                    f"CPU at <b>{cpu_pct:.0f}%</b> (threshold: {cpu_thresh}%)\n"
                    f"Sustained for {CPU_HIGH_COUNT_TRIGGER} consecutive reports{host}"
                ), agent.name)

    # ── 3. New SSH login detected ────────────────────────
    if _flag(agent, "login"):
        logins = snapshot.get("recent_logins") or []
        if logins:
            # Build a set of unique session identifiers from this report.
            # session_id is "user@source@timestamp" (set by the agent script).
            # Fall back to "user@ip" for older agents that don't send session_id.
            current_ids: set[str] = set()
            for entry in logins:
                sid = entry.get("session_id") or (
                    f"{entry.get('username', 'unknown')}@{entry.get('ip', 'local')}"
                )
                current_ids.add(sid)

            if state["seen_login_ids"] is None:
                # First report: establish baseline without alerting.
                state["seen_login_ids"] = current_ids
            else:
                new_sessions = current_ids - state["seen_login_ids"]
                for sid in new_sessions:
                    # Find the matching entry to get display details.
                    entry = next(
                        (e for e in logins if (e.get("session_id") or
                            f"{e.get('username','unknown')}@{e.get('ip','local')}") == sid),
                        logins[0],
                    )
                    username = str(entry.get("username") or "unknown")
                    ip       = str(entry.get("ip") or "")
                    ts       = str(entry.get("timestamp") or "")
                    await _tg(tpl, (
                        f"👤 <b>New SSH login</b> — <b>{agent.name}</b>\n"
                        f"User: <code>{username}</code>\n"
                        f"From: <code>{ip or 'local/console'}</code>"
                        + (f"\nTime: {ts}" if ts else "")
                        + host
                    ), agent.name)
                # Merge so we don't re-alert on sessions that later fall off the list.
                # Cap at 500 entries to prevent unbounded growth.
                merged = state["seen_login_ids"] | current_ids
                if len(merged) > 500:
                    merged = current_ids  # reset to current snapshot
                state["seen_login_ids"] = merged

    # ── 4. Pending OS updates ────────────────────────────
    if _flag(agent, "updates"):
        updates      = snapshot.get("pending_updates") or []
        update_count = len(updates)
        updates_cooldown_expired = (now - state["updates_alerted_at"]) > UPDATES_ALERT_COOLDOWN
        count_changed = update_count != state["updates_count_last"]
        if update_count > 0 and updates_cooldown_expired and count_changed:
            state["updates_alerted_at"] = now
            state["updates_count_last"] = update_count
            lines = ""
            for u in updates[:5]:
                pkg = u.get("package", "?")
                cur = u.get("current_version", "")
                new = u.get("new_version", "")
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
        if not agent.alert_template_id or not _flag(agent, "container_stopped"):
            return
        tpl = await db.get(TelegramTemplate, agent.alert_template_id)
        if not tpl:
            return
        label = cs.display_name or cs.name
        host  = f"\nHost: <code>{agent.hostname}</code>" if agent.hostname else ""
        await _tg(tpl, (
            f"🚨 <b>Container stopped</b> — <b>{agent.name}</b>\n"
            f"<code>{label}</code>: <code>{old_status}</code> → <code>{new_status}</code>\n"
            f"Image: <code>{cs.image}</code>{host}"
        ), agent.name)


async def check_vps_offline() -> None:
    """
    APScheduler job (runs every 60 s).
    Alerts when an agent has not reported in for OFFLINE_THRESHOLD_S seconds.
    """
    from datetime import datetime, timezone as tz
    from app.core.database import AsyncSessionFactory

    try:
        async with AsyncSessionFactory() as db:
            result = await db.execute(
                select(VPSAgent).where(
                    VPSAgent.is_enabled == True,
                    VPSAgent.alert_template_id.is_not(None),
                    VPSAgent.last_seen.is_not(None),
                )
            )
            agents = result.scalars().all()

            now_wall = time.monotonic()
            now_dt   = datetime.now(tz.utc)

            for agent in agents:
                if not _flag(agent, "offline"):
                    continue

                last = agent.last_seen
                if last.tzinfo is None:
                    last = last.replace(tzinfo=tz.utc)
                seconds_offline = (now_dt - last).total_seconds()

                agent_id_str = str(agent.id)
                state = _get_alert_state(agent_id_str)

                if seconds_offline > OFFLINE_THRESHOLD_S:
                    _offline_agents.add(agent_id_str)
                    if (now_wall - state["offline_alerted_at"]) > OFFLINE_ALERT_COOLDOWN:
                        state["offline_alerted_at"] = now_wall
                        tpl = await db.get(TelegramTemplate, agent.alert_template_id)
                        if tpl:
                            mins = int(seconds_offline / 60)
                            host = f"\nHost: <code>{agent.hostname}</code>" if agent.hostname else ""
                            await _tg(tpl, (
                                f"🔴 <b>VPS offline</b> — <b>{agent.name}</b>\n"
                                f"No heartbeat for <b>{mins}m</b>{host}"
                            ), agent.name)
    except Exception as exc:
        logger.error("check_vps_offline failed: %s", exc)


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
            old_status = existing.status
            # Only overwrite name/image/status if the incoming value is real.
            # container_logs entries arrive without these fields (name="unknown",
            # status="unknown", image="") — don't let them clobber the real values.
            if name != "unknown":  existing.name  = name
            if image:              existing.image = image
            if status != "unknown": existing.status = status
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
            # Skip inserting a stub row from a container_logs-only entry.
            # Such entries have no real name/status and will be populated on
            # the next docker_container_status batch (within 15 s).
            if name == "unknown" and status == "unknown" and not image:
                continue
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

        elif name == "disk":
            # disk metric absent inside container (root is overlay, which is ignored).
            # Accept any non-empty path — prefer "/" but take the first one we see.
            path = tags.get("path", "")
            if path and not sys_data.get("disk_total_bytes"):
                sys_data["disk_used_bytes"]  = int(fields.get("used",  0) or 0)
                sys_data["disk_total_bytes"] = int(fields.get("total", 0) or 0)

        elif name == "system":
            sys_data["load_avg_1m"] = float(fields.get("load1", 0) or 0)
            sys_data["load_avg_5m"] = float(fields.get("load5", 0) or 0)
            # uptime field dropped in Telegraf 1.38 inputs.system
            if fields.get("uptime"):
                sys_data["uptime_seconds"] = int(fields["uptime"])

        elif name == "docker_container_status":
            # Telegraf 1.35+: container_id moved from tags → fields
            cid = (fields.get("container_id") or tags.get("container_id") or "")[:12]
            if cid:
                c = containers.setdefault(cid, {"docker_id": cid})
                c["name"]   = (tags.get("container_name")  or "unknown").lstrip("/")
                c["image"]  = tags.get("container_image")  or ""
                c["status"] = (tags.get("container_status") or "unknown").lower()

        elif name == "docker_container_cpu" and tags.get("cpu") == "cpu-total":
            cid = (fields.get("container_id") or tags.get("container_id") or "")[:12]
            if cid:
                containers.setdefault(cid, {"docker_id": cid})["cpu_percent"] = (
                    round(float(fields.get("usage_percent", 0) or 0), 2)
                )

        elif name == "docker_container_mem":
            cid = (fields.get("container_id") or tags.get("container_id") or "")[:12]
            if cid:
                c = containers.setdefault(cid, {"docker_id": cid})
                c["mem_usage_bytes"] = int(fields.get("usage", 0) or 0)
                c["mem_limit_bytes"] = int(fields.get("limit", 0) or 0)

        elif name == "apt_updates":
            try:    updates = _json.loads(str(fields.get("value", "[]")))
            except Exception as e:
                logger.debug("Failed to parse telegraf field '%s': %s", name, e)

        elif name == "systemd_failed":
            val = str(fields.get("value", "")).strip()
            if val:
                failed = [s.strip() for s in val.split(",") if s.strip()]

        elif name == "recent_logins":
            try:    logins = _json.loads(str(fields.get("value", "[]")))
            except Exception as e:
                logger.debug("Failed to parse telegraf field '%s': %s", name, e)

        elif name == "container_logs":
            try:
                logs_map = _json.loads(str(fields.get("value", "{}")))
                for cid, lines in logs_map.items():
                    if isinstance(lines, list):
                        containers.setdefault(cid, {"docker_id": cid})["last_logs"] = lines[:15]
            except Exception as e:
                logger.debug("Failed to parse telegraf field '%s': %s", name, e)

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
    # Only update container state when the report actually includes container data.
    if containers:
        await _upsert_containers(db, agent_id, agent, containers)
    return AgentReportResponse()


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
    return AgentReportResponse()


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
        cpu_alert_threshold=req.cpu_alert_threshold,
        alert_flags=req.alert_flags,
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
    agent = await get_or_404(db, VPSAgent, agent_id)
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
    agent = await get_or_404(db, VPSAgent, agent_id)
    name = agent.name
    await db.delete(agent)
    await log_action(db, admin, "container_agent_delete", f"Deleted VPS agent: {name}")
    await db.commit()
    return {"deleted": True}


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
