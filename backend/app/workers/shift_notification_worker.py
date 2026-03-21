"""Shift notification worker.

Runs every 60 seconds. Fires a shift start notification when the UTC clock
enters the 60-second window that contains a shift's default_start_time.
One notification per (date, shift_type) is guaranteed by ShiftNotificationLog.
"""
import logging
from datetime import datetime, timezone, timedelta, date as date_type
from sqlalchemy import select
from app.core.database import AsyncSessionFactory
from app.models.models import ShiftConfig, ShiftNotificationLog, ShiftType
from app.services.telegram_service import notify_shift_start, notify_office_roster

logger = logging.getLogger(__name__)


async def check_shift_notifications():
    """Fire shift start notifications based on UTC time matching ShiftConfig.default_start_time."""
    now = datetime.now(timezone.utc)
    today: date_type = now.date()
    window_start = now - timedelta(seconds=60)

    async with AsyncSessionFactory() as db:
        try:
            configs_result = await db.execute(select(ShiftConfig).where(ShiftConfig.is_active == True))
            for config in configs_result.scalars().all():
                if config.default_start_time is None:
                    continue

                # Build the exact UTC datetime this shift starts today
                shift_start = datetime.combine(today, config.default_start_time, tzinfo=timezone.utc)

                # Is this shift starting within the current 60-second poll window?
                if not (window_start < shift_start <= now):
                    continue

                # Already notified for this (date, shift_type)?
                existing = await db.execute(
                    select(ShiftNotificationLog).where(
                        ShiftNotificationLog.date == today,
                        ShiftNotificationLog.shift_type == config.shift_type,
                    )
                )
                if existing.scalar_one_or_none():
                    continue

                # Fire
                if config.shift_type == ShiftType.OFFICE:
                    await notify_office_roster()
                else:
                    await notify_shift_start(config.shift_type)

                db.add(ShiftNotificationLog(date=today, shift_type=config.shift_type))
                await db.commit()
                logger.info("Shift notification sent: %s on %s", config.shift_type, today)

        except Exception:
            logger.exception("Shift notification worker error")
            await db.rollback()
