"""Startup synchronization for active Zammad tickets."""
import json
import logging

import httpx

from app.api.tickets import _extract_fields
from app.core.config import get_settings
from app.core.database import AsyncSessionFactory
from app.models.models import ZammadEvent

logger = logging.getLogger(__name__)


ACTIVE_TICKETS_QUERY = 'state.name:(new OR open OR in_progress OR "pending reminder")'


async def sync_active_zammad_tickets() -> None:
    """Fetch active Zammad tickets and store them as ticket_sync events."""
    settings = get_settings()
    if not settings.ZAMMAD_SYNC_ON_STARTUP:
        return
    if not settings.ZAMMAD_URL or not settings.ZAMMAD_API_TOKEN:
        logger.info("[tickets] Zammad startup sync skipped: ZAMMAD_URL or ZAMMAD_API_TOKEN is not set")
        return

    base_url = settings.ZAMMAD_URL.rstrip("/")
    headers = {"Authorization": f"Token token={settings.ZAMMAD_API_TOKEN}"}

    try:
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                f"{base_url}/api/v1/tickets/search",
                params={"query": ACTIVE_TICKETS_QUERY},
                headers=headers,
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        logger.warning("[tickets] Zammad startup sync failed: %s", exc)
        return

    data = response.json()
    ticket_assets = data.get("assets", {}).get("Ticket", {})
    if not isinstance(ticket_assets, dict):
        logger.warning("[tickets] Zammad startup sync returned an unexpected payload")
        return

    async with AsyncSessionFactory() as db:
        for ticket in ticket_assets.values():
            if not isinstance(ticket, dict):
                continue
            payload = {"ticket": ticket, "source": "startup_sync"}
            fields = _extract_fields("ticket_sync", payload)
            db.add(ZammadEvent(
                event_type="ticket_sync",
                payload=json.dumps(payload, ensure_ascii=False),
                **fields,
            ))
        await db.commit()

    logger.info("[tickets] Zammad startup sync stored %d active ticket(s)", len(ticket_assets))
