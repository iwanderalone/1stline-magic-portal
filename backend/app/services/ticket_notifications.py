"""Telegram alerts for Zammad ticket lifecycle.

Three alerts (compact, English):
  - opened          → a ticket enters the 'open' state (incl. new arrivals)
  - open-overdue    → still 'open' past 15 / 30 / 60 min (escalation)
  - solved          → a ticket transitions to 'closed'

Opened/solved fire from the webhook receiver on a real state transition.
Open-overdue is a periodic worker. Disabled unless ZAMMAD_TELEGRAM_CHAT_ID is set.
"""
import html
import logging

from sqlalchemy import select

from app.core.config import get_settings
from app.core.database import AsyncSessionFactory
from app.models.models import ZammadTicket, utcnow
from app.services.telegram_service import send_telegram_message

logger = logging.getLogger(__name__)

ESCALATION_STEPS = (15, 30, 60)  # minutes
DESCRIPTION_LIMIT = 3000  # hard cap on ticket text (Telegram messages max out at 4096)


def _esc(text) -> str:
    return html.escape(str(text)) if text is not None else ""


def _target() -> tuple[str, str]:
    from app.core.dynamic_settings import eff
    s = get_settings()
    chat_id = eff("ZAMMAD_TELEGRAM_CHAT_ID", s.ZAMMAD_TELEGRAM_CHAT_ID)
    thread_id = eff("ZAMMAD_TELEGRAM_THREAD_ID", s.ZAMMAD_TELEGRAM_THREAD_ID)
    return (chat_id or "").strip(), (thread_id or "").strip()


def _body(text: str, limit: int = DESCRIPTION_LIMIT) -> str:
    """Ticket text as a collapsed, tap-to-expand Telegram blockquote (same as mail alerts)."""
    text = "\n".join(line.strip() for line in (text or "").splitlines()).strip()
    if len(text) > limit:
        text = text[: limit - 1].rstrip() + "…"
    return f"<blockquote expandable>{_esc(text)}</blockquote>"


def _format(emoji: str, label: str, tk: ZammadTicket) -> str:
    lines = [f"{emoji} <b>{_esc(label)}</b>", f"#{_esc(tk.number or tk.id)} — {_esc(tk.title or '—')}"]
    if tk.customer:
        lines.append(f"Customer: {_esc(tk.customer)}")
    category = tk.request_type or tk.group_name
    if category:
        lines.append(f"Category: {_esc(category)}")
    if tk.description:
        lines.append("")
        lines.append(_body(tk.description))
    return "\n".join(lines)


async def _send(text: str) -> bool:
    chat_id, thread = _target()
    if not chat_id:
        return False
    return await send_telegram_message(chat_id, text, thread or None)


async def notify_ticket_opened(tk: ZammadTicket) -> None:
    if await _send(_format("🆕", "Open ticket", tk)):
        logger.info("[tickets] sent 'opened' Telegram alert for ticket %s", tk.id)


async def notify_ticket_solved(tk: ZammadTicket) -> None:
    if await _send(_format("✅", "Ticket solved", tk)):
        logger.info("[tickets] sent 'solved' Telegram alert for ticket %s", tk.id)


async def check_open_ticket_escalations() -> None:
    """Periodic: alert on tickets still 'open' past each escalation step."""
    chat_id, _ = _target()
    if not chat_id:
        return
    now = utcnow()
    async with AsyncSessionFactory() as db:
        tickets = (await db.execute(
            select(ZammadTicket).where(ZammadTicket.state == "open")
        )).scalars().all()
        for tk in tickets:
            if not tk.state_changed_at:
                continue
            elapsed_min = (now - tk.state_changed_at).total_seconds() / 60
            level = 0
            for i, step in enumerate(ESCALATION_STEPS, start=1):
                if elapsed_min >= step:
                    level = i
            if level > (tk.open_alert_level or 0):
                mins = ESCALATION_STEPS[level - 1]
                if await _send(_format("⏰", f"Still open · {mins}+ min", tk)):
                    logger.info("[tickets] sent open-overdue (%s min) alert for ticket %s", mins, tk.id)
                tk.open_alert_level = level
        await db.commit()
