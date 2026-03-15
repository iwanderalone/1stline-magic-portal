"""Telegram bot service — personal + group chat notifications."""
import logging
from datetime import date, datetime, timezone, timedelta
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
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json=payload)
            if not resp.is_success:
                logger.error(
                    f"Telegram send failed: HTTP {resp.status_code} — {resp.text}"
                )
                return False
            return True
    except httpx.HTTPStatusError as e:
        logger.error(
            f"Telegram send failed: HTTP {e.response.status_code} — {e.response.text}"
        )
        return False
    except Exception as e:
        logger.error(f"Telegram send failed (network/timeout): {type(e).__name__}: {e}")
        return False


async def _get_roster(db, shift_type: ShiftType, on_date: date) -> list[str]:
    """Return a list of display strings for published shifts of a given type on a given date."""
    result = await db.execute(
        select(Shift).where(
            and_(Shift.date == on_date, Shift.shift_type == shift_type, Shift.is_published == True)
        )
    )
    lines = []
    for s in result.scalars().all():
        user_result = await db.execute(select(User).where(User.id == s.user_id))
        u = user_result.scalar_one_or_none()
        if u:
            loc = f" ({s.location.value})" if s.location else ""
            lines.append((u, s, f"  • {u.display_name}{loc}"))
    return lines


async def notify_shift_start(shift_type: ShiftType, force_send: bool = False) -> dict:
    """Send shift start notification to configured group chats.

    Day shift  (07:45): today's day roster   + tonight's night roster
    Night shift (19:45): tonight's night roster + tomorrow's day roster

    force_send=True skips the "no shifts" early-exit (used by admin test button).
    Returns {"chats_sent": int, "dms_sent": int, "had_shifts": bool}.
    """
    today = date.today()
    tomorrow = today + timedelta(days=1)

    async with AsyncSessionFactory() as db:
        if shift_type == ShiftType.DAY:
            title       = "☀️ <b>Day Shift Starting</b>"
            flag_field  = "notify_day_shift_start"
            primary     = await _get_roster(db, ShiftType.DAY,   today)
            upcoming    = await _get_roster(db, ShiftType.NIGHT,  today)
            upcoming_label = f"🌙 Tonight's night shift ({today.strftime('%d %b')})"
        elif shift_type == ShiftType.NIGHT:
            title       = "🌙 <b>Night Shift Starting</b>"
            flag_field  = "notify_night_shift_start"
            primary     = await _get_roster(db, ShiftType.NIGHT, today)
            upcoming    = await _get_roster(db, ShiftType.DAY,   tomorrow)
            upcoming_label = f"☀️ Tomorrow's day shift ({tomorrow.strftime('%d %b')})"
        else:
            # OFFICE handled by notify_office_roster
            return {"chats_sent": 0, "dms_sent": 0, "had_shifts": False}

        if not primary and not force_send:
            return {"chats_sent": 0, "dms_sent": 0, "had_shifts": False}

        # ── Group chat message ──────────────────────────────
        primary_lines   = [row[2] for row in primary]
        upcoming_lines  = [row[2] for row in upcoming]

        msg = f"{title}\n{today.strftime('%A, %d %b %Y')}\n\n"
        if primary_lines:
            msg += "\n".join(primary_lines)
        else:
            msg += "  — no shifts scheduled yet"
        if upcoming_lines:
            msg += f"\n\n{upcoming_label}:\n" + "\n".join(upcoming_lines)
        else:
            msg += f"\n\n{upcoming_label}:\n  — not scheduled yet"

        chats_result = await db.execute(
            select(TelegramChat).where(
                and_(TelegramChat.is_active == True, getattr(TelegramChat, flag_field) == True)
            )
        )
        chats_sent = 0
        for chat in chats_result.scalars().all():
            if await send_telegram_message(chat.chat_id, msg, chat.topic_id):
                chats_sent += 1

        # ── Personal DMs to workers on the current shift ────
        try:
            portal_tz = ZoneInfo(get_settings().PORTAL_TIMEZONE)
        except ZoneInfoNotFoundError:
            portal_tz = ZoneInfo("UTC")

        dms_sent = 0
        for u, s, _ in primary:
            if not (u.telegram_chat_id and u.telegram_notify_shifts):
                continue
            personal_msg = f"{title}\n\nYou're on shift today ({shift_type.value})"
            if s.start_time:
                try:
                    user_tz = ZoneInfo(u.timezone or "UTC")
                except ZoneInfoNotFoundError:
                    user_tz = ZoneInfo("UTC")
                local_start = datetime.combine(today, s.start_time).replace(tzinfo=portal_tz).astimezone(user_tz)
                personal_msg += f"\nStarts at {local_start.strftime('%H:%M')} ({u.timezone or 'UTC'})"

            # Append the upcoming roster so each worker knows who's next
            if upcoming_lines:
                personal_msg += f"\n\n{upcoming_label}:\n" + "\n".join(upcoming_lines)

            if await send_telegram_message(u.telegram_chat_id, personal_msg):
                dms_sent += 1

        return {"chats_sent": chats_sent, "dms_sent": dms_sent, "had_shifts": bool(primary)}


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

        # Personal DMs to office workers
        for s in shift_list:
            user_result = await db.execute(select(User).where(User.id == s.user_id))
            u = user_result.scalar_one_or_none()
            if u and u.telegram_chat_id and u.telegram_notify_shifts:
                loc = f" ({s.location.value})" if s.location else ""
                personal_msg = f"🏢 <b>Office shift today</b>\n{today.strftime('%A, %d %b %Y')}{loc}"
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
                    local_start = dt.combine(today, s.start_time).replace(tzinfo=portal_tz).astimezone(user_tz)
                    personal_msg += f"\nStarts at {local_start.strftime('%H:%M')} ({u.timezone or 'UTC'})"
                await send_telegram_message(u.telegram_chat_id, personal_msg)


# ─── Bot update polling ──────────────────────────────────

_bot_offset = 0


async def poll_telegram_updates():
    """Poll for Telegram bot updates via getUpdates short-polling (2s timeout).
    APScheduler runs this every 5s with max_instances=1 so runs never overlap."""
    global _bot_offset
    if not settings.TELEGRAM_BOT_TOKEN:
        return
    import httpx
    url = f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/getUpdates"
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            resp = await client.get(url, params={
                "offset": _bot_offset,
                "timeout": 2,
                "allowed_updates": ["message"],
            })
            if not resp.is_success:
                logger.error(f"Telegram poll error: HTTP {resp.status_code} — {resp.text}")
                return
            data = resp.json()
            if not data.get("ok"):
                logger.error(f"Telegram poll error: {data.get('description', data)}")
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
    except httpx.TimeoutException:
        # Normal when Telegram has no updates — not an error
        pass
    except Exception as e:
        logger.error(f"Telegram polling error: {type(e).__name__}: {e}")


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
