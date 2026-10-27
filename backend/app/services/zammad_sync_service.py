"""Synchronization for active Zammad tickets (startup + periodic)."""
import logging

import httpx

from app.api.tickets import upsert_ticket
from app.core.config import get_settings
from app.core.database import AsyncSessionFactory

logger = logging.getLogger(__name__)


ACTIVE_STATES = ("new", "open", "in_progress", "pending reminder")
ACTIVE_TICKETS_QUERY = "state.name:(" + " OR ".join(
    f'"{s}"' if " " in s else s for s in ACTIVE_STATES) + ")"


def _extract_ticket_list(data: object) -> list[dict]:
    """Normalize Zammad search responses across API shapes."""
    if isinstance(data, list):
        return [ticket for ticket in data if isinstance(ticket, dict)]

    if not isinstance(data, dict):
        return []

    assets = data.get("assets") or {}
    if isinstance(assets, dict):
        ticket_assets = assets.get("Ticket")
        if isinstance(ticket_assets, dict):
            return [ticket for ticket in ticket_assets.values() if isinstance(ticket, dict)]
        if isinstance(ticket_assets, list):
            return [ticket for ticket in ticket_assets if isinstance(ticket, dict)]

    tickets = data.get("tickets") or data.get("records") or []
    if isinstance(tickets, list):
        return [ticket for ticket in tickets if isinstance(ticket, dict)]

    return []


async def sync_active_zammad_tickets(*, force: bool = False) -> None:
    """Fetch active Zammad tickets and upsert them into the ticket board.

    Runs at startup and on a periodic schedule. Uses the search API with
    ``expand=true`` so state/owner/customer/group come back as readable names
    (the lean search records only carry numeric *_id fields). Idempotent:
    upserts current state per ticket rather than appending events.

    Pass ``force=True`` to bypass the ZAMMAD_SYNC_ON_STARTUP gate (used by the
    periodic worker, which has its own enable condition).
    """
    from app.core.dynamic_settings import eff
    settings = get_settings()
    if not force and not settings.ZAMMAD_SYNC_ON_STARTUP:
        return
    zammad_api_token = eff("ZAMMAD_API_TOKEN", settings.ZAMMAD_API_TOKEN)
    if not settings.ZAMMAD_URL or not zammad_api_token:
        logger.info("[tickets] Zammad sync skipped: ZAMMAD_URL or ZAMMAD_API_TOKEN is not set")
        return

    base_url = settings.ZAMMAD_URL.rstrip("/")
    headers = {"Authorization": f"Token token={zammad_api_token}"}

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                f"{base_url}/api/v1/tickets/search",
                params={"query": ACTIVE_TICKETS_QUERY, "expand": "true", "limit": 200},
                headers=headers,
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("[tickets] Zammad sync failed: %s", exc)
        return

    tickets = _extract_ticket_list(response.json())
    if not tickets:
        logger.warning("[tickets] Zammad sync returned no tickets / unexpected payload")
        return

    async with AsyncSessionFactory() as db:
        for ticket in tickets:
            await upsert_ticket(db, "ticket_sync", {"ticket": ticket})
        await db.commit()

    ticket_ids = [tk.get("id") for tk in tickets if tk.get("id")]
    refreshed = await refresh_stale_active_tickets(set(ticket_ids), base_url, headers)
    backfilled = await backfill_ticket_articles(ticket_ids)
    logger.info(
        "[tickets] Zammad sync upserted %d active ticket(s), refreshed %d stale, backfilled %d comment(s)",
        len(tickets), refreshed, backfilled,
    )


async def refresh_stale_active_tickets(active_ids: set[int], base_url: str, headers: dict) -> int:
    """Re-read tickets we still hold as active that Zammad no longer lists.

    The active search only returns live tickets, so a close that never reached
    us as a webhook (missed delivery, or an instance Zammad doesn't call, like
    dev) would leave the row 'open' forever — and the escalation job keeps
    announcing it. Fetching those few tickets directly settles their state.
    """
    from sqlalchemy import select
    from app.models.models import ZammadTicket

    async with AsyncSessionFactory() as db:
        stale = (await db.execute(
            select(ZammadTicket.id).where(ZammadTicket.state.in_(ACTIVE_STATES))
        )).scalars().all()
    stale = [tid for tid in stale if tid not in active_ids]
    if not stale:
        return 0

    refreshed = 0
    async with httpx.AsyncClient(timeout=15) as client, AsyncSessionFactory() as db:
        for tid in stale:
            try:
                resp = await client.get(
                    f"{base_url}/api/v1/tickets/{tid}",
                    params={"expand": "true"},
                    headers=headers,
                )
                if resp.status_code == 404:
                    # Deleted or merged away in Zammad: stop treating it as live.
                    tk = await db.get(ZammadTicket, tid)
                    if tk:
                        tk.state = "removed"
                    refreshed += 1
                    continue
                resp.raise_for_status()
            except httpx.HTTPError as exc:
                logger.warning("[tickets] refresh failed for ticket %s: %s", tid, exc)
                continue
            ticket = resp.json()
            if isinstance(ticket, dict) and ticket.get("id"):
                await upsert_ticket(db, "ticket_sync", {"ticket": ticket})
                refreshed += 1
        await db.commit()
    return refreshed


async def backfill_ticket_articles(ticket_ids: list[int]) -> int:
    """Import missing article history for the given tickets from the Zammad API.

    Comments normally arrive via webhooks; this covers everything posted before
    the webhooks existed (or while the portal was down). Deduped by article id,
    so re-running is free. Returns the number of newly stored comments.
    """
    from sqlalchemy import select
    from app.api.tickets import _extract_comment
    from app.models.models import ZammadComment, ZammadTicket

    from app.core.dynamic_settings import eff
    settings = get_settings()
    zammad_api_token = eff("ZAMMAD_API_TOKEN", settings.ZAMMAD_API_TOKEN)
    if not settings.ZAMMAD_URL or not zammad_api_token:
        return 0
    base_url = settings.ZAMMAD_URL.rstrip("/")
    headers = {"Authorization": f"Token token={zammad_api_token}"}
    added = 0

    async with httpx.AsyncClient(timeout=15) as client, AsyncSessionFactory() as db:
        for tid in ticket_ids:
            try:
                resp = await client.get(
                    f"{base_url}/api/v1/ticket_articles/by_ticket/{tid}",
                    params={"expand": "true"},
                    headers=headers,
                )
                resp.raise_for_status()
                articles = resp.json()
            except httpx.HTTPError as exc:
                logger.warning("[tickets] article backfill failed for ticket %s: %s", tid, exc)
                continue
            if not isinstance(articles, list):
                continue

            existing_ids = set((await db.execute(
                select(ZammadComment.article_id).where(ZammadComment.ticket_id == tid)
            )).scalars().all())
            last_body = None
            for art in articles:
                comment = _extract_comment({"article": art})
                if not comment or comment.get("article_id") in existing_ids:
                    continue
                db.add(ZammadComment(ticket_id=tid, **comment))
                existing_ids.add(comment.get("article_id"))
                last_body = comment["body"]
                added += 1
            if last_body:
                tk = await db.get(ZammadTicket, tid)
                if tk and not tk.last_comment:
                    tk.last_comment = last_body[:2000]
        await db.commit()
    return added
