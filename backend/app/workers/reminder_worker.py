"""Background reminder worker using APScheduler.

Runs every 30 seconds, checks for due reminders, fires notifications.
"""
import asyncio
import logging
from datetime import datetime, timezone, timedelta
from sqlalchemy import select, and_
from app.core.database import AsyncSessionFactory
from app.models.models import Reminder, Notification, ReminderStatus, User
from app.services.telegram_service import send_telegram_message

logger = logging.getLogger(__name__)


async def check_and_fire_reminders():
    """Check for due reminders and send notifications."""
    now = datetime.now(timezone.utc)

    async with AsyncSessionFactory() as db:
        try:
            result = await db.execute(
                select(Reminder)
                .where(
                    and_(
                        Reminder.status == ReminderStatus.ACTIVE,
                        Reminder.remind_at <= now,
                    )
                )
                .limit(100)
            )
            due_reminders = result.scalars().all()

            for reminder in due_reminders:
                # Get user for telegram notification
                user_result = await db.execute(
                    select(User).where(User.id == reminder.user_id)
                )
                user = user_result.scalar_one_or_none()
                if not user:
                    continue

                # In-app notification
                if reminder.notify_in_app:
                    notif = Notification(
                        user_id=reminder.user_id,
                        title=f"Reminder: {reminder.title}",
                        message=reminder.description or reminder.title,
                    )
                    db.add(notif)

                # Telegram notification
                if reminder.notify_telegram and user.telegram_chat_id:
                    text = (
                        f"🔔 <b>Reminder</b>\n\n"
                        f"<b>{reminder.title}</b>\n"
                        f"{reminder.description or ''}"
                    )
                    await send_telegram_message(user.telegram_chat_id, text)

                # Handle recurring
                if reminder.is_recurring and reminder.recurrence_minutes:
                    reminder.remind_at = now + timedelta(minutes=reminder.recurrence_minutes)
                    reminder.fired_at = now
                else:
                    reminder.status = ReminderStatus.FIRED
                    reminder.fired_at = now

                logger.info(f"Fired reminder {reminder.id} for user {user.display_name}")

            await db.commit()

        except Exception as e:
            logger.error(f"Reminder worker error: {e}")
            await db.rollback()
