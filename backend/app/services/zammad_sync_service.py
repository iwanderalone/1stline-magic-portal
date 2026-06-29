"""Synchronization for active Zammad tickets (startup + periodic)."""
import logging

import httpx

from app.api.tickets import upsert_ticket
from app.core.config import get_settings
from app.core.database import AsyncSessionFactory

logger = logging.getLogger(__name__)


ACTIVE_TICKETS_QUERY = 'state.name:(new OR open OR in_progress OR "pending reminder")'


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
    settings = get_settings()
    if not force and not settings.ZAMMAD_SYNC_ON_STARTUP:
        return
    if not settings.ZAMMAD_URL or not settings.ZAMMAD_API_TOKEN:
        logger.info("[tickets] Zammad sync skipped: ZAMMAD_URL or ZAMMAD_API_TOKEN is not set")
        return

    base_url = settings.ZAMMAD_URL.rstrip("/")
    headers = {"Authorization": f"Token token={settings.ZAMMAD_API_TOKEN}"}

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

    logger.info("[tickets] Zammad sync upserted %d active ticket(s)", len(tickets))
