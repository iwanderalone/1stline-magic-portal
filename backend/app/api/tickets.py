"""Zammad ticket events — webhook receiver and event log viewer."""
import hashlib
import hmac
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlalchemy import select, desc, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.models import ZammadEvent, User
from app.schemas.schemas import ZammadWebhookPayload, ZammadEventResponse

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tickets", tags=["tickets"])

VALID_EVENT_TYPES = {
    "ticket_opened",
    "ticket_assigned",
    "comment_added",
    "ticket_closed",
    "ticket_paused",
    "ticket_status_changed",
    "ticket_sync",
}


def detect_events(body: dict) -> list[str]:
    """Infer Zammad event types from a raw webhook payload."""
    ticket = body.get("ticket") or {}
    article = body.get("article") or {}
    preferences = article.get("preferences") or {}

    if ticket.get("article_count") == 1:
        return ["ticket_opened"]

    detected: list[str] = []
    article_body = article.get("body") or ""
    sender_type = article.get("sender") or ""
    if article_body.strip() and sender_type != "System" and article_body != "...":
        detected.append("comment_added")

    if "new_status" in preferences:
        new_status = str(preferences.get("new_status") or "").lower()
        if new_status in {"closed", "closed successful", "закрыт"}:
            detected.append("ticket_closed")
        elif any(word in new_status for word in ["pending", "paused", "приостановлен", "пауза", "hold"]):
            detected.append("ticket_paused")
        else:
            detected.append("ticket_status_changed")

    if (
        "new_owner_id" in preferences
        or "new_owner" in preferences
        or preferences.get("comment_type") == "owner_change"
    ):
        detected.append("ticket_assigned")

    return detected


def _extract_fields(event_type: str, body: dict) -> dict:
    """Pull the fields we store from the raw Zammad payload."""
    ticket = body.get("ticket") or {}
    article = body.get("article") or {}

    state_obj = ticket.get("state") or {}
    ticket_state = state_obj.get("name") if isinstance(state_obj, dict) else str(state_obj)

    owner_obj = ticket.get("owner") or {}
    if isinstance(owner_obj, dict):
        fn = owner_obj.get("firstname", "")
        ln = owner_obj.get("lastname", "")
        login = owner_obj.get("login", "")
        assignee = f"{fn} {ln}".strip() or login or None
    else:
        assignee = str(owner_obj) if owner_obj else None

    customer_obj = ticket.get("customer") or {}
    if isinstance(customer_obj, dict):
        customer = customer_obj.get("email") or customer_obj.get("login") or None
    else:
        customer = str(customer_obj) if customer_obj else None

    group_obj = ticket.get("group") or {}
    ticket_group = group_obj.get("name") if isinstance(group_obj, dict) else str(group_obj) if group_obj else None

    prio_obj = ticket.get("priority") or {}
    ticket_priority = prio_obj.get("name") if isinstance(prio_obj, dict) else str(prio_obj) if prio_obj else None

    article_body: Optional[str] = None
    if event_type == "comment_added" and article:
        raw = article.get("body") or ""
        article_body = raw[:2000] if raw else None

    return {
        "ticket_id": ticket.get("id"),
        "ticket_number": str(ticket.get("number")) if ticket.get("number") else None,
        "ticket_title": (ticket.get("title") or "")[:500] or None,
        "ticket_state": ticket_state,
        "ticket_group": ticket_group,
        "ticket_priority": ticket_priority,
        "assignee": assignee,
        "customer": customer,
        "article_body": article_body,
    }


# ─── Webhook receiver ─────────────────────────────────────

@router.post(
    "/webhook",
    status_code=204,
    summary="Zammad webhook receiver",
    description=(
        "Receives Zammad webhook events. Configure one trigger per event type in Zammad "
        "and set the URL to include `?event=<type>`. "
        "Supported values: `ticket_opened`, `ticket_assigned`, `comment_added`, "
        "`ticket_closed`, `ticket_paused`, `ticket_status_changed`, `ticket_sync`. "
        "If `event` is omitted, the backend auto-detects one or more event types.\n\n"
        "Optional HMAC verification: set `ZAMMAD_WEBHOOK_SECRET` env var to the same "
        "value entered in Zammad's **HMAC SHA1 Signature Token** field. "
        "Zammad sends `X-Hub-Signature: sha1=<hex>` and the endpoint will reject "
        "requests with an invalid signature."
    ),
)
async def receive_webhook(
    request: Request,
    event: Optional[str] = Query(default=None, description="Event type, e.g. ticket_opened. Omit to auto-detect."),
    x_hub_signature: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db),
):
    settings = get_settings()
    raw_body = await request.body()

    if settings.ZAMMAD_WEBHOOK_SECRET:
        expected = "sha1=" + hmac.new(
            settings.ZAMMAD_WEBHOOK_SECRET.encode(),
            raw_body,
            hashlib.sha1,
        ).hexdigest()
        if not x_hub_signature or not hmac.compare_digest(x_hub_signature, expected):
            logger.warning("[tickets] Webhook rejected — invalid HMAC signature")
            raise HTTPException(status_code=401, detail="Invalid webhook signature")

    try:
        body = json.loads(raw_body) if raw_body else {}
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON body")

    events = [event] if event else detect_events(body)
    if not events:
        logger.info("[tickets] Ignored Zammad webhook without a supported event")
        return

    invalid = [ev for ev in events if ev not in VALID_EVENT_TYPES]
    if invalid:
        raise HTTPException(
            status_code=422,
            detail=f"Unknown event type(s) {invalid}. Valid: {sorted(VALID_EVENT_TYPES)}",
        )

    payload_text = raw_body.decode("utf-8", errors="replace")
    for event_type in events:
        fields = _extract_fields(event_type, body)
        db.add(ZammadEvent(
            event_type=event_type,
            payload=payload_text,
            **fields,
        ))
    await db.commit()
    logger.info("[tickets] stored %d Zammad event(s): %s", len(events), events)


# ─── Event log ────────────────────────────────────────────

@router.get(
    "/events",
    response_model=list[ZammadEventResponse],
    summary="List ticket events",
    description="Returns recent Zammad ticket events. Filterable by event type.",
)
async def list_events(
    event_type: Optional[str] = Query(default=None, description="Filter by event type"),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(ZammadEvent).order_by(desc(ZammadEvent.received_at))
    if event_type:
        q = q.where(ZammadEvent.event_type == event_type)
    q = q.offset(offset).limit(limit)
    result = await db.execute(q)
    return result.scalars().all()


@router.get(
    "/events/count",
    summary="Count ticket events",
    description="Returns total event count, optionally filtered by event type.",
)
async def count_events(
    event_type: Optional[str] = Query(default=None),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(func.count()).select_from(ZammadEvent)
    if event_type:
        q = q.where(ZammadEvent.event_type == event_type)
    result = await db.execute(q)
    return {"count": result.scalar_one()}


@router.get(
    "/events/{event_id}",
    response_model=ZammadEventResponse,
    summary="Get single ticket event with raw payload",
)
async def get_event(
    event_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(ZammadEvent).where(ZammadEvent.id == event_id))
    ev = result.scalar_one_or_none()
    if not ev:
        raise HTTPException(status_code=404, detail="Event not found")
    return ev
