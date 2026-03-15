"""Telegram bot service — personal + group chat notifications."""
import logging
from datetime import date, datetime, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import get_settings
from app.core.database import AsyncSessionFactory
from app.models.models import (
    User, Shift, Reminder, ReminderStatus, ShiftType,
    TelegramChat, WorkLocation,
)

logger = logging.getLogger(__name__)
settings = get_settings()


async def send_telegram_message(chat_id: str, text: str, topic_id: str = None) -> bool:
    if not settings.TELEGRAM_BOT_TOKEN:
        logger.warning("Telegram bot token not configured")
        return False
    import httpx
    url = f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage"
    payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
    if topic_id:
        payload["message_thread_id"] = int(topic_id)
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            return True
    except Exception as e:
        logger.error(f"Telegram send failed: {e}")
        return False


async def notify_shift_start(shift_type: ShiftType):
    """Send shift start notification to configured group chats."""
    today = date.today()
    async with AsyncSessionFactory() as db:
        # Get today's shifts of this type
        shifts = await db.execute(
            select(Shift).where(
                and_(Shift.date == today, Shift.shift_type == shift_type, Shift.is_published == True)
            )
        )
        shift_list = shifts.scalars().all()
        if not shift_list:
            return

        # Build roster
        lines = []
        for s in shift_list:
            user = await db.execute(select(User).where(User.id == s.user_id))
            u = user.scalar_one_or_none()
            if u:
                loc = ""
                if s.location:
                    loc = f" ({s.location.value})"
                lines.append(f"  • {u.display_name}{loc}")

        if shift_type == ShiftType.DAY:
            title = "☀️ <b>Day Shift Starting</b>"
            flag_field = "notify_day_shift_start"
        elif shift_type == ShiftType.NIGHT:
            title = "🌙 <b>Night Shift Starting</b>"
            flag_field = "notify_night_shift_start"
        else:
            title = "🏢 <b>Office Roster</b>"
            flag_field = "notify_office_roster"

        message = f"{title}\n{today.strftime('%A, %d %b %Y')}\n\n" + "\n".join(lines)

        # Get group chats configured for this notification type
        chats = await db.execute(
            select(TelegramChat).where(
                and_(TelegramChat.is_active == True, getattr(TelegramChat, flag_field) == True)
            )
        )
        for chat in chats.scalars().all():
            await send_telegram_message(chat.chat_id, message, chat.topic_id)

        # Also notify individual users who have telegram linked and shift notifications on
        for s in shift_list:
            user = await db.execute(select(User).where(User.id == s.user_id))
            u = user.scalar_one_or_none()
            if u and u.telegram_chat_id and u.telegram_notify_shifts:
                personal_msg = f"{title}\n\nYou're on shift today ({shift_type.value})"
                if s.start_time:
                    try:
                        user_tz = ZoneInfo(u.timezone or "UTC")
                    except ZoneInfoNotFoundError:
                        user_tz = ZoneInfo("UTC")
                    from datetime import datetime as dt
                    from app.core.config import get_settings as _gs
                    try:
                        portal_tz = ZoneInfo(_gs().PORTAL_TIMEZONE)
                    except ZoneInfoNotFoundError:
                        portal_tz = ZoneInfo("UTC")
                    # start_time is naive — interpret in portal timezone, display in user's timezone
                    local_start = dt.combine(today, s.start_time).replace(tzinfo=portal_tz).astimezone(user_tz)
                    personal_msg += f"\nStarts at {local_start.strftime('%H:%M')} ({u.timezone or 'UTC'})"
                await send_telegram_message(u.telegram_chat_id, personal_msg)


async def notify_office_roster():
    """Send office roster to configured group chats."""
    today = date.today()
    async with AsyncSessionFactory() as db:
        shifts = await db.execute(
            select(Shift).where(
                and_(
                    Shift.date == today,
                    Shift.shift_type == ShiftType.OFFICE,
                    Shift.is_published == True,
                )
            )
        )
        shift_list = shifts.scalars().all()
        if not shift_list:
            return

        onsite = []
        remote = []
        for s in shift_list:
            user = await db.execute(select(User).where(User.id == s.user_id))
            u = user.scalar_one_or_none()
            if u:
                if s.location == WorkLocation.ONSITE:
                    onsite.append(u.display_name)
                else:
                    remote.append(u.display_name)

        lines = [f"🏢 <b>Office Roster</b>", f"{today.strftime('%A, %d %b %Y')}", ""]
        if onsite:
            lines.append("<b>In Office:</b>")
            for name in onsite:
                lines.append(f"  • {name}")
        if remote:
            lines.append("<b>Remote:</b>")
            for name in remote:
                lines.append(f"  • {name}")

        message = "\n".join(lines)

        chats = await db.execute(
            select(TelegramChat).where(
                and_(TelegramChat.is_active == True, TelegramChat.notify_office_roster == True)
            )
        )
        for chat in chats.scalars().all():
            await send_telegram_message(chat.chat_id, message, chat.topic_id)


# ─── Bot update polling ──────────────────────────────────

_bot_offset = 0


async def poll_telegram_updates():
    """Poll for Telegram bot updates every few seconds via getUpdates long-polling."""
    global _bot_offset
    if not settings.TELEGRAM_BOT_TOKEN:
        return
    import httpx
    url = f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/getUpdates"
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(url, params={
                "offset": _bot_offset,
                "timeout": 3,
                "allowed_updates": ["message"],
            })
            data = resp.json()
            if not data.get("ok"):
                return
            for update in data.get("result", []):
                _bot_offset = update["update_id"] + 1
                msg = update.get("message", {})
                text = (msg.get("text") or "").strip()
                chat_id = str(msg.get("chat", {}).get("id", ""))
                if not text or not chat_id:
                    continue
                if text.startswith("/link"):
                    parts = text.split()
                    code = parts[1] if len(parts) > 1 else ""
                    reply = await handle_link_command(chat_id, code)
                    await send_telegram_message(chat_id, reply)
                elif text.startswith("/myshift"):
                    reply = await handle_myshift_command(chat_id)
                    await send_telegram_message(chat_id, reply)
    except Exception as e:
        logger.error(f"Telegram polling error: {e}")


# ─── Bot command handlers ────────────────────────────────

async def handle_link_command(chat_id: str, code: str) -> str:
    async with AsyncSessionFactory() as db:
        result = await db.execute(
            select(User).where(User.telegram_link_code == code.upper())
        )
        user = result.scalar_one_or_none()
        if not user:
            return "Invalid link code. Ask your admin to generate a new one."
        user.telegram_chat_id = chat_id
        user.telegram_link_code = None
        await db.commit()
        return f"Linked to {user.display_name}. You'll receive notifications here."


async def handle_myshift_command(chat_id: str) -> str:
    async with AsyncSessionFactory() as db:
        result = await db.execute(select(User).where(User.telegram_chat_id == chat_id))
        user = result.scalar_one_or_none()
        if not user:
            return "Not linked. Use /link <code> first."
        today = date.today()
        shifts = await db.execute(
            select(Shift).where(
                and_(Shift.user_id == user.id, Shift.date >= today)
            ).order_by(Shift.date).limit(5)
        )
        shift_list = shifts.scalars().all()
        if not shift_list:
            return "No upcoming shifts."
        lines = [f"<b>Upcoming shifts for {user.display_name}:</b>"]
        for s in shift_list:
            loc = f" ({s.location.value})" if s.location else ""
            lines.append(f"  {s.date.strftime('%a %d %b')} — {s.shift_type.value}{loc}")
        return "\n".join(lines)
