"""Telegram bot for notifications and quick commands.

This module provides:
- send_telegram_message(): Send notification to a user
- TelegramBot class: Handles /start, /link, /myshift, /reminders commands
"""
import asyncio
import logging
from datetime import date, datetime, timezone
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import get_settings
from app.core.database import AsyncSessionFactory
from app.models.models import User, Shift, Reminder, ReminderStatus

logger = logging.getLogger(__name__)
settings = get_settings()


async def send_telegram_message(chat_id: str, text: str) -> bool:
    """Send a message via Telegram Bot API."""
    if not settings.TELEGRAM_BOT_TOKEN:
        logger.warning("Telegram bot token not configured, skipping notification")
        return False

    import httpx
    url = f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage"
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json={
                "chat_id": chat_id,
                "text": text,
                "parse_mode": "HTML",
            })
            resp.raise_for_status()
            return True
    except Exception as e:
        logger.error(f"Telegram send failed: {e}")
        return False


async def handle_link_command(chat_id: str, username: str, code: str) -> str:
    """Link a Telegram account to a portal user via verification code."""
    async with AsyncSessionFactory() as db:
        result = await db.execute(
            select(User).where(User.telegram_link_code == code.upper())
        )
        user = result.scalar_one_or_none()
        if not user:
            return "Invalid link code. Ask your admin to generate a new one."

        user.telegram_chat_id = chat_id
        user.telegram_link_code = None  # Expire the code
        await db.commit()
        return f"Linked to {user.display_name}. You'll now receive notifications here."


async def handle_myshift_command(chat_id: str) -> str:
    """Show the user's current and next shift."""
    async with AsyncSessionFactory() as db:
        result = await db.execute(select(User).where(User.telegram_chat_id == chat_id))
        user = result.scalar_one_or_none()
        if not user:
            return "Your Telegram is not linked. Use /link <code> first."

        today = date.today()
        shifts = await db.execute(
            select(Shift).where(
                and_(Shift.user_id == user.id, Shift.date >= today)
            ).order_by(Shift.date).limit(3)
        )
        shift_list = shifts.scalars().all()
        if not shift_list:
            return "No upcoming shifts found."

        lines = [f"<b>Upcoming shifts for {user.display_name}:</b>"]
        for s in shift_list:
            lines.append(f"  {s.date.strftime('%a %d %b')} — {s.shift_type.value}")
        return "\n".join(lines)


async def handle_reminders_command(chat_id: str) -> str:
    """Show active reminders."""
    async with AsyncSessionFactory() as db:
        result = await db.execute(select(User).where(User.telegram_chat_id == chat_id))
        user = result.scalar_one_or_none()
        if not user:
            return "Your Telegram is not linked. Use /link <code> first."

        reminders = await db.execute(
            select(Reminder).where(
                and_(
                    Reminder.user_id == user.id,
                    Reminder.status == ReminderStatus.ACTIVE,
                )
            ).order_by(Reminder.remind_at).limit(10)
        )
        rem_list = reminders.scalars().all()
        if not rem_list:
            return "No active reminders."

        lines = [f"<b>Active reminders:</b>"]
        for r in rem_list:
            time_str = r.remind_at.strftime("%d %b %H:%M")
            lines.append(f"  {time_str} — {r.title}")
        return "\n".join(lines)
