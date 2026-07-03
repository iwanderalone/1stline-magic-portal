"""Grafana alert webhook receiver and alert list."""
import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlalchemy import select, desc, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.models import GrafanaAlert, User, utcnow
from app.schemas.schemas import GrafanaAlertResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/alerts", tags=["alerts"])


def _parse_dt(value) -> Optional[datetime]:
    if not value or not isinstance(value, str):
        return None
    # Grafana uses RFC3339; "0001-01-01T00:00:00Z" means "not set".
    if value.startswith("0001-"):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


@router.post(
    "/grafana/webhook",
    status_code=204,
    summary="Grafana alert webhook receiver",
    description=(
        "Add the portal as a **webhook contact point** in Grafana Alerting and point it here. "
        "If `GRAFANA_WEBHOOK_TOKEN` is set, configure the same value as a Bearer token on the "
        "contact point (Authorization header). Alerts are upserted by fingerprint: firing "
        "notifications create/refresh a row, resolved notifications close it."
    ),
)
async def receive_grafana_webhook(
    request: Request,
    authorization: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    settings = get_settings()
    if settings.GRAFANA_WEBHOOK_TOKEN:
        expected = f"Bearer {settings.GRAFANA_WEBHOOK_TOKEN}"
        if not authorization or authorization.strip() != expected:
            logger.warning("[alerts] Grafana webhook rejected — bad or missing bearer token")
            raise HTTPException(status_code=401, detail="Invalid webhook token")

    try:
        body = json.loads(await request.body() or b"{}")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    alerts = body.get("alerts") or []
    if not isinstance(alerts, list) or not alerts:
        logger.info("[alerts] Grafana webhook without alerts — ignored")
        return

    now = utcnow()
    stored = 0
    for alert in alerts:
        if not isinstance(alert, dict):
            continue
        fingerprint = alert.get("fingerprint")
        if not fingerprint:
            continue
        labels = alert.get("labels") or {}
        annotations = alert.get("annotations") or {}
        status = "resolved" if alert.get("status") == "resolved" else "firing"

        row = (await db.execute(
            select(GrafanaAlert).where(GrafanaAlert.fingerprint == fingerprint)
        )).scalar_one_or_none()

        if row is None:
            row = GrafanaAlert(fingerprint=fingerprint, received_at=now, fire_count=1)
            db.add(row)
        elif status == "firing" and row.status == "resolved":
            row.fire_count = (row.fire_count or 1) + 1   # re-fired after being resolved

        row.status = status
        row.alertname = (labels.get("alertname") or row.alertname or "")[:200] or None
        row.severity = (labels.get("severity") or row.severity or "")[:50] or None
        row.summary = annotations.get("summary") or annotations.get("description") or row.summary
        row.labels = json.dumps(labels, ensure_ascii=False)
        row.generator_url = (alert.get("generatorURL") or row.generator_url or "")[:500] or None
        row.starts_at = _parse_dt(alert.get("startsAt")) or row.starts_at
        row.ends_at = _parse_dt(alert.get("endsAt")) if status == "resolved" else None
        row.updated_at = now
        stored += 1

    await db.commit()
    logger.info("[alerts] Grafana webhook processed %d alert(s)", stored)


@router.get(
    "",
    response_model=list[GrafanaAlertResponse],
    summary="List Grafana alerts",
)
async def list_alerts(
    status: Optional[str] = Query(default=None, description="firing | resolved"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    # Firing first, then most recently updated.
    q = select(GrafanaAlert).order_by(
        (GrafanaAlert.status != "firing"), desc(GrafanaAlert.updated_at)
    )
    if status in ("firing", "resolved"):
        q = q.where(GrafanaAlert.status == status)
    result = await db.execute(q.offset(offset).limit(limit))
    return result.scalars().all()


@router.get(
    "/counts",
    summary="Alert counts (for the home banner)",
)
async def alert_counts(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(GrafanaAlert.status, func.count()).group_by(GrafanaAlert.status)
    )
    counts = {"firing": 0, "resolved": 0}
    for status, cnt in result.all():
        counts[status] = cnt
    counts["total"] = counts["firing"] + counts["resolved"]
    return counts
