"""Service Status board — Prometheus `remote_write` receiver + status API.

Prometheus streams blackbox-exporter samples straight into the portal; we keep
only the newest value per target and render it. Prometheus config:

    remote_write:
      - url: https://portal.example.com/api/status/remote-write
        authorization:
          credentials: <PROMETHEUS_REMOTE_WRITE_TOKEN>
        write_relabel_configs:
          - source_labels: [__name__]
            regex: 'probe_.*'
            action: keep
"""
import json
import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.models import ServiceProbe, User, utcnow
from app.services.remote_write import ProtobufError, Series, decode_write_request

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/status", tags=["status"])

# Labels that identify a series rather than describe the target — dropped
# before the rest are stored for grouping/filtering.
_NOISE_LABELS = {"__name__", "version"}

# Metrics we keep. Anything else in the push is ignored, so a loose
# write_relabel_config on the Prometheus side can't pollute the board.
_WANTED = {
    "probe_success",
    "probe_http_status_code",
    "probe_http_ssl",
    "probe_ssl_earliest_cert_expiry",
    "probe_duration_seconds",
    "probe_dns_lookup_time_seconds",
    "probe_ip_protocol",
    "probe_tls_version_info",
}

_last_prune: Optional[datetime] = None


def _eff(key: str, cast=None):
    from app.core.dynamic_settings import eff
    default = getattr(get_settings(), key)
    return eff(key, default, cast=cast) if cast else eff(key, default)


def _finite(value: float) -> Optional[float]:
    """None for NaN/inf, which blackbox emits for metrics it could not measure."""
    return value if isinstance(value, (int, float)) and math.isfinite(value) else None


def _ts(millis: int) -> Optional[datetime]:
    if not millis:
        return None
    return datetime.fromtimestamp(millis / 1000, tz=timezone.utc)


def _apply(row: ServiceProbe, series: Series) -> None:
    """Fold one time series' newest sample into the target's row."""
    latest = series.latest
    if latest is None:
        return
    value, millis = latest
    name = series.name

    # A probe that never connects reports NaN for the metrics it could not
    # measure (status code, cert expiry), so every numeric read goes through
    # _finite — int(NaN) raises, and one such sample used to 500 the batch.
    finite = _finite(value)

    if name == "probe_success":
        row.up = value == 1
    elif name == "probe_http_status_code":
        row.http_status = int(finite) or None if finite is not None else None
    elif name == "probe_http_ssl":
        row.ssl_ok = value == 1
    elif name == "probe_ssl_earliest_cert_expiry":
        row.ssl_expiry_at = _ts(int(finite * 1000)) if finite and finite > 0 else None
    elif name == "probe_duration_seconds":
        row.probe_duration = finite
    elif name == "probe_dns_lookup_time_seconds":
        row.dns_lookup = finite
    elif name == "probe_ip_protocol":
        row.ip_protocol = str(int(finite)) if finite is not None else None
    elif name == "probe_tls_version_info":
        # An info metric: the value is 1, the TLS version rides on a label.
        if value == 1 and series.labels.get("version"):
            row.tls_version = series.labels["version"][:20]

    sample_at = _ts(millis)
    if sample_at and (row.sample_at is None or sample_at > row.sample_at):
        row.sample_at = sample_at


@router.post(
    "/remote-write",
    status_code=204,
    summary="Prometheus remote_write receiver",
    description=(
        "Accepts snappy-compressed protobuf `prometheus.WriteRequest` (remote-write v1) "
        "and keeps the newest blackbox-exporter sample per target. Requires "
        "`Authorization: Bearer <PROMETHEUS_REMOTE_WRITE_TOKEN>`; with no token "
        "configured the endpoint refuses all writes."
    ),
)
async def remote_write(
    request: Request,
    authorization: Optional[str] = Header(default=None),
    content_type: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    global _last_prune

    token = (_eff("PROMETHEUS_REMOTE_WRITE_TOKEN") or "").strip()
    if not token:
        logger.warning("[status] remote_write rejected — PROMETHEUS_REMOTE_WRITE_TOKEN is not set")
        raise HTTPException(status_code=503, detail="Status ingestion is not configured")
    if not authorization or authorization.strip() != f"Bearer {token}":
        logger.warning("[status] remote_write rejected — bad or missing bearer token")
        raise HTTPException(status_code=401, detail="Invalid remote_write token")

    # remote-write 2.0 uses a different message with a symbol table; refuse it
    # loudly rather than silently decoding garbage. 415 stops Prometheus retrying.
    if content_type and "io.prometheus.write.v2.Request" in content_type:
        raise HTTPException(
            status_code=415,
            detail="remote-write 2.0 is not supported — omit protobuf_message to send v1",
        )

    try:
        series_list = decode_write_request(await request.body())
    except ProtobufError as exc:
        logger.warning("[status] remote_write payload rejected: %s", exc)
        raise HTTPException(status_code=400, detail=str(exc))

    # Group the push by target so each row is touched once.
    by_instance: dict[str, list[Series]] = {}
    for series in series_list:
        if series.name not in _WANTED:
            continue
        instance = (series.labels.get("instance") or "").strip()
        if instance:
            by_instance.setdefault(instance[:500], []).append(series)

    if not by_instance:
        logger.debug("[status] remote_write push carried no probe series")
        return

    existing = {
        row.instance: row
        for row in (await db.execute(
            select(ServiceProbe).where(ServiceProbe.instance.in_(by_instance.keys()))
        )).scalars().all()
    }

    for instance, series_group in by_instance.items():
        row = existing.get(instance)
        is_new = row is None
        if is_new:
            row = ServiceProbe(instance=instance)
            db.add(row)
        was_up = row.up
        for series in series_group:
            try:
                _apply(row, series)
            except Exception:
                logger.warning(
                    "[status] skipped unusable series %s for %s", series.name, instance, exc_info=True
                )
        # Track when up/down last flipped so the UI can say "down for 20m"
        # instead of only "down".
        if is_new or row.up is not was_up:
            row.state_changed_at = row.sample_at or utcnow()
        # Descriptive labels come from any series of the group; they are identical
        # across metrics for a given target apart from the noise ones.
        labels = {
            k: v for k, v in series_group[0].labels.items()
            if k not in _NOISE_LABELS and not k.startswith("__")
        }
        row.job = (labels.get("job") or "")[:200] or None
        row.labels = json.dumps(labels, ensure_ascii=False)
        row.updated_at = utcnow()

    # Targets removed from Prometheus would otherwise linger forever. Sweep at
    # most hourly so this stays cheap on a 30s push cadence.
    now = utcnow()
    if _last_prune is None or (now - _last_prune) > timedelta(hours=1):
        cutoff = now - timedelta(hours=_eff("STATUS_PRUNE_AFTER_HOURS", cast=int))
        await db.execute(delete(ServiceProbe).where(ServiceProbe.sample_at < cutoff))
        _last_prune = now

    await db.commit()
    logger.debug("[status] remote_write updated %d target(s)", len(by_instance))


def _serialize(row: ServiceProbe, now: datetime, stale_after: int) -> dict:
    try:
        labels = json.loads(row.labels) if row.labels else {}
    except ValueError:
        labels = {}

    age = (now - row.sample_at).total_seconds() if row.sample_at else None
    ssl_days = (
        (row.ssl_expiry_at - now).total_seconds() / 86400 if row.ssl_expiry_at else None
    )
    return {
        "instance": row.instance,
        "job": row.job,
        "labels": labels,
        "up": row.up,
        "http_status": row.http_status,
        "ssl_ok": row.ssl_ok,
        "tls_version": row.tls_version,
        "ssl_expiry_at": row.ssl_expiry_at,
        "ssl_expiry_days": round(ssl_days, 1) if ssl_days is not None else None,
        "probe_duration": row.probe_duration,
        "dns_lookup": row.dns_lookup,
        "ip_protocol": row.ip_protocol,
        "sample_at": row.sample_at,
        "state_changed_at": row.state_changed_at,
        "in_state_seconds": (
            round((now - row.state_changed_at).total_seconds()) if row.state_changed_at else None
        ),
        "age_seconds": round(age) if age is not None else None,
        "stale": age is None or age > stale_after,
    }


@router.get(
    "",
    summary="Service status board",
    description="Current blackbox probe state for every target, grouped into sections.",
)
async def status_board(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    group_label = (_eff("STATUS_GROUP_LABEL") or "job").strip() or "job"
    stale_after = _eff("STATUS_STALE_AFTER_SECONDS", cast=int)
    now = utcnow()

    rows = (await db.execute(
        select(ServiceProbe).order_by(ServiceProbe.instance)
    )).scalars().all()

    groups: dict[str, list[dict]] = {}
    for row in rows:
        item = _serialize(row, now, stale_after)
        name = item["labels"].get(group_label) or row.job or "other"
        groups.setdefault(name, []).append(item)

    # Fixed section order (STATUS_GROUP_ORDER), so the board reads the same way
    # every time; anything unlisted follows alphabetically. Problems surface via
    # the summary tiles and per-row colour rather than by reordering sections.
    order = [x.strip().lower() for x in (_eff("STATUS_GROUP_ORDER") or "").split(",") if x.strip()]

    def section_rank(entry):
        name = entry[0].lower()
        return (order.index(name), "") if name in order else (len(order), name)

    return {
        "group_label": group_label,
        "group_order": order,
        "stale_after_seconds": stale_after,
        "groups": [
            {"name": name, "targets": targets}
            for name, targets in sorted(groups.items(), key=section_rank)
        ],
    }


@router.get(
    "/summary",
    summary="Status summary counters",
    description="Health-summary tiles: down, HTTP 5xx, certs expiring within 7 days, stale, average latency.",
)
async def status_summary(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    stale_after = _eff("STATUS_STALE_AFTER_SECONDS", cast=int)
    now = utcnow()
    rows = (await db.execute(select(ServiceProbe))).scalars().all()

    down = http_5xx = certs_expiring = stale = 0
    durations: list[float] = []
    for row in rows:
        fresh = row.sample_at is not None and (now - row.sample_at).total_seconds() <= stale_after
        if not fresh:
            stale += 1
            continue
        if row.up is False:
            down += 1
        if row.http_status and 500 <= row.http_status < 600:
            http_5xx += 1
        if row.ssl_expiry_at and (row.ssl_expiry_at - now) < timedelta(days=7):
            certs_expiring += 1
        if row.probe_duration is not None:
            durations.append(row.probe_duration)

    return {
        "total": len(rows),
        "down": down,
        "http_5xx": http_5xx,
        "certs_expiring": certs_expiring,
        "stale": stale,
        "avg_latency_ms": round(sum(durations) / len(durations) * 1000) if durations else None,
        "last_push_at": max((r.sample_at for r in rows if r.sample_at), default=None),
    }
