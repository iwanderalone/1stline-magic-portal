"""Zammad write client — change ticket state and post articles (notes/replies).

All calls use the configured ZAMMAD_API_TOKEN (a service account). Errors from
Zammad are surfaced as ZammadError so the API layer can return a clean message.
"""
import logging
from typing import Optional

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# States the portal is allowed to set (kept in sync with the frontend control).
ALLOWED_STATES = ("open", "in_progress", "on_pause", "closed")


class ZammadError(Exception):
    """Raised when Zammad rejects a write or is unreachable."""


def _client() -> httpx.AsyncClient:
    settings = get_settings()
    if not settings.ZAMMAD_URL or not settings.ZAMMAD_API_TOKEN:
        raise ZammadError("Zammad is not configured (ZAMMAD_URL / ZAMMAD_API_TOKEN missing)")
    return httpx.AsyncClient(
        base_url=settings.ZAMMAD_URL.rstrip("/"),
        headers={"Authorization": f"Token token={settings.ZAMMAD_API_TOKEN}"},
        timeout=15,
    )


async def _request(method: str, path: str, json: dict) -> dict:
    try:
        async with _client() as client:
            resp = await client.request(method, path, json=json)
    except httpx.HTTPError as exc:
        raise ZammadError(f"Zammad unreachable: {exc}") from exc
    if resp.status_code >= 400:
        detail = resp.text[:300]
        logger.warning("[tickets] Zammad write %s %s failed (%s): %s", method, path, resp.status_code, detail)
        raise ZammadError(f"Zammad returned {resp.status_code}: {detail}")
    return resp.json()


async def update_ticket_state(ticket_id: int, state: str) -> dict:
    """Change a ticket's state. `state` must be one of ALLOWED_STATES."""
    if state not in ALLOWED_STATES:
        raise ZammadError(f"State '{state}' is not allowed. Choose one of {ALLOWED_STATES}.")
    return await _request("PUT", f"/api/v1/tickets/{ticket_id}", {"state": state})


async def add_article(
    ticket_id: int,
    body: str,
    *,
    public: bool,
    to: Optional[str] = None,
) -> dict:
    """Post an article to a ticket.

    public=False → internal note (team-only, no customer email).
    public=True  → email article to the customer (actually sends mail).
    """
    settings = get_settings()
    if public and not settings.ZAMMAD_ALLOW_PUBLIC_REPLY:
        raise ZammadError("Public replies are disabled on this portal (ZAMMAD_ALLOW_PUBLIC_REPLY=false)")

    payload = {
        "ticket_id": ticket_id,
        "body": body,
        "content_type": "text/plain",
        "type": "email" if public else "note",
        "internal": not public,
    }
    if public and to:
        payload["to"] = to
    try:
        return await _request("POST", "/api/v1/ticket_articles", payload)
    except ZammadError as exc:
        # Common precondition: the ticket's group has no sending email address,
        # so Zammad can't dispatch a customer email. Make it actionable.
        if public and "email address" in str(exc).lower():
            raise ZammadError(
                "Can't send a public reply — Zammad has no sending email address "
                "for this ticket's group. Configure an email channel in Zammad "
                "(Admin → Channels → Email) and assign it to the group, or post an "
                "internal note instead."
            ) from exc
        raise
