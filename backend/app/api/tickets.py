"""Zammad ticket events — webhook receiver and event log viewer."""
import hashlib
import hmac
import json
import logging
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from sqlalchemy import select, desc, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_current_user
from app.models.models import ZammadEvent, ZammadTicket, ZammadComment, User, utcnow
from app.schemas.schemas import (
    ZammadWebhookPayload, ZammadEventResponse,
    ZammadTicketResponse, ZammadTicketDetail, ZammadCommentResponse,
)

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


def _clean(s: Optional[str]) -> Optional[str]:
    """Normalize Zammad placeholder values ('', '-') to None."""
    if not isinstance(s, str):
        return s
    s = s.strip()
    return s if s and s != "-" else None


def _person_name(value) -> Optional[str]:
    """Human-readable name from a Zammad person field (dict, string, or None)."""
    if isinstance(value, dict):
        fn = value.get("firstname", "")
        ln = value.get("lastname", "")
        return f"{fn} {ln}".strip() or _clean(value.get("login")) or _clean(value.get("email"))
    return _clean(value)


def _assoc_name(value) -> Optional[str]:
    """Name from a Zammad association field (dict with .name, string, or None).

    Handles all three shapes Zammad emits:
      - webhook payloads: nested object {"name": "open"}
      - search API with expand=true: plain string "open"
      - lean records: the field is absent (only state_id etc.) → None
    """
    if isinstance(value, dict):
        return _clean(value.get("name"))
    return _clean(value)


def _customer_name(value) -> Optional[str]:
    if isinstance(value, dict):
        return _clean(value.get("email")) or _clean(value.get("login")) or _person_name(value)
    return _clean(value)


def _extract_fields(event_type: str, body: dict) -> dict:
    """Pull the fields we store from a Zammad payload (event-log row)."""
    ticket = body.get("ticket") or {}
    article = body.get("article") or {}

    article_body: Optional[str] = None
    if event_type == "comment_added" and article:
        raw = article.get("body") or ""
        article_body = raw[:2000] if raw else None

    return {
        "ticket_id": ticket.get("id"),
        "ticket_number": str(ticket.get("number")) if ticket.get("number") else None,
        "ticket_title": (ticket.get("title") or "")[:500] or None,
        "ticket_state": _assoc_name(ticket.get("state")),
        "ticket_group": _assoc_name(ticket.get("group")),
        "ticket_priority": _assoc_name(ticket.get("priority")),
        "assignee": _person_name(ticket.get("owner")),
        "customer": _customer_name(ticket.get("customer")),
        "article_body": article_body,
    }


# ─── Ticket-centric upsert (current state + comment thread) ──────────────

# Map Zammad state names to coarse buckets for the board.
def state_bucket(state: Optional[str]) -> str:
    s = (state or "").lower()
    if any(w in s for w in ("closed", "merged", "removed", "resolved")):
        return "closed"
    if any(w in s for w in ("pending", "waiting", "hold", "paused")):
        return "paused"
    return "open"


def _parse_dt(value) -> Optional[datetime]:
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _extract_comment(body: dict) -> Optional[dict]:
    """Build a comment record from an article, or None if it isn't a real comment."""
    article = body.get("article") or {}
    text = (article.get("body") or "").strip()
    sender = article.get("sender") or ""
    if not text or text == "..." or sender == "System":
        return None
    return {
        "article_id": article.get("id"),
        "author": article.get("from") or _person_name(article.get("created_by")) or sender or None,
        "sender": sender or None,
        "body": text[:8000],
        "internal": bool(article.get("internal")),
        "zammad_created_at": _parse_dt(article.get("created_at")),
    }


async def upsert_ticket(
    db: AsyncSession,
    event_type: str,
    body: dict,
    received_at: Optional[datetime] = None,
) -> None:
    """Upsert the current-state ZammadTicket row and any new comment."""
    ticket = body.get("ticket") or {}
    tid = ticket.get("id")
    if not tid:
        return

    fields = _extract_fields(event_type, body)
    comment = _extract_comment(body)
    now = received_at or utcnow()

    existing = await db.get(ZammadTicket, tid)
    if existing is None:
        existing = ZammadTicket(id=tid, created_at=now)
        db.add(existing)

    # Keep non-empty identity fields (never blank a number/title).
    def _set(attr, value):
        if value not in (None, ""):
            setattr(existing, attr, value)

    # Associations are authoritative when Zammad includes the key: honor the
    # value even when it clears the field (e.g. a ticket becoming unassigned).
    # When the key is absent (a sparse payload), keep the existing value.
    def _set_assoc(attr, key, value):
        if key in ticket:
            setattr(existing, attr, value)

    _set("number", fields["ticket_number"])
    _set("title", fields["ticket_title"])
    _set_assoc("state", "state", fields["ticket_state"])
    _set_assoc("group_name", "group", fields["ticket_group"])
    _set_assoc("priority", "priority", fields["ticket_priority"])
    _set_assoc("assignee", "owner", fields["assignee"])
    _set_assoc("customer", "customer", fields["customer"])
    if ticket.get("article_count") is not None:
        existing.article_count = ticket.get("article_count")
    _set("zammad_created_at", _parse_dt(ticket.get("created_at")))
    _set("zammad_updated_at", _parse_dt(ticket.get("updated_at")))
    existing.last_event_type = event_type
    existing.last_event_at = now

    if comment:
        existing.last_comment = comment["body"][:2000]
        # Dedup by Zammad article id when present; otherwise allow the insert.
        art_id = comment.get("article_id")
        if art_id is not None:
            dup = await db.execute(
                select(ZammadComment.id).where(ZammadComment.article_id == art_id)
            )
            if dup.scalar_one_or_none() is not None:
                return
        db.add(ZammadComment(
            ticket_id=tid,
            article_id=comment["article_id"],
            author=comment["author"],
            sender=comment["sender"],
            body=comment["body"],
            internal=comment["internal"],
            zammad_created_at=comment["zammad_created_at"],
        ))


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
        await upsert_ticket(db, event_type, body)
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


# ─── Ticket board (current state, ticket-centric) ─────────

def _ticket_url(ticket_id: int) -> Optional[str]:
    base = get_settings().ZAMMAD_URL.rstrip("/")
    return f"{base}/#ticket/zoom/{ticket_id}" if base else None


def _ticket_payload(t: ZammadTicket) -> dict:
    return {
        "id": t.id,
        "number": t.number,
        "title": t.title,
        "state": t.state,
        "bucket": state_bucket(t.state),
        "group_name": t.group_name,
        "priority": t.priority,
        "assignee": t.assignee,
        "customer": t.customer,
        "article_count": t.article_count,
        "last_comment": t.last_comment,
        "last_event_type": t.last_event_type,
        "last_event_at": t.last_event_at,
        "zammad_created_at": t.zammad_created_at,
        "zammad_updated_at": t.zammad_updated_at,
        "url": _ticket_url(t.id),
    }


@router.get(
    "/board",
    response_model=list[ZammadTicketResponse],
    summary="List tickets (current state)",
    description="Ticket-centric board. Filter by status bucket (open/paused/closed) and search by number, title, assignee or customer.",
)
async def list_tickets(
    bucket: Optional[str] = Query(default=None, description="open | paused | closed"),
    search: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(ZammadTicket).order_by(desc(ZammadTicket.last_event_at))
    if search:
        like = f"%{search.strip()}%"
        q = q.where(or_(
            ZammadTicket.number.ilike(like),
            ZammadTicket.title.ilike(like),
            ZammadTicket.assignee.ilike(like),
            ZammadTicket.customer.ilike(like),
        ))
    result = await db.execute(q)
    tickets = result.scalars().all()
    # Bucket is derived from the state string, so filter in Python.
    if bucket in {"open", "paused", "closed"}:
        tickets = [t for t in tickets if state_bucket(t.state) == bucket]
    return [_ticket_payload(t) for t in tickets[offset:offset + limit]]


@router.get(
    "/board/counts",
    summary="Ticket counts per status bucket",
)
async def ticket_counts(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(ZammadTicket.state))
    counts = {"all": 0, "open": 0, "paused": 0, "closed": 0}
    for (state,) in result.all():
        counts["all"] += 1
        counts[state_bucket(state)] += 1
    return counts


@router.get(
    "/board/{ticket_id}",
    response_model=ZammadTicketDetail,
    summary="Ticket detail with comment thread and recent events",
)
async def ticket_detail(
    ticket_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    t = await db.get(ZammadTicket, ticket_id)
    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found")

    comments_res = await db.execute(
        select(ZammadComment)
        .where(ZammadComment.ticket_id == ticket_id)
        .order_by(ZammadComment.zammad_created_at.nullslast(), ZammadComment.id)
    )
    events_res = await db.execute(
        select(ZammadEvent)
        .where(ZammadEvent.ticket_id == ticket_id)
        .order_by(desc(ZammadEvent.received_at))
        .limit(50)
    )
    payload = _ticket_payload(t)
    payload["comments"] = [
        ZammadCommentResponse.model_validate(c) for c in comments_res.scalars().all()
    ]
    payload["events"] = [
        ZammadEventResponse.model_validate(e) for e in events_res.scalars().all()
    ]
    return payload
