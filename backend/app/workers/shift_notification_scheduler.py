"""Shift notification pre-scheduler.

Called on startup and after each publish to register one-time APScheduler
'date' jobs that fire exactly when each shift's default_start_time is reached
in UTC. ShiftNotificationLog prevents duplicate sends even if jobs are
accidentally double-scheduled (e.g. after restart + re-publish).
"""
import logging
from datetime import datetime, timezone, date as date_type
from sqlalchemy import select
from app.core.database import AsyncSessionFactory
from app.models.models import ShiftConfig, ShiftNotificationLog, Shift, ShiftType

logger = logging.getLogger(__name__)


async def _fire_notification(shift_type_value: str, shift_date_iso: str) -> None:
    """APScheduler 'date' job: fire one shift start notification and log it."""
    from app.services.telegram_service import notify_shift_start, notify_office_roster

    shift_type = ShiftType(shift_type_value)
    shift_date = date_type.fromisoformat(shift_date_iso)

    async with AsyncSessionFactory() as db:
        # Deduplication guard (safe even if job was double-scheduled)
        existing = await db.execute(
            select(ShiftNotificationLog).where(
                ShiftNotificationLog.date == shift_date,
                ShiftNotificationLog.shift_type == shift_type,
            )
        )
        if existing.scalar_one_or_none():
            logger.info("Shift notification already sent: %s %s — skipping", shift_type, shift_date)
            return

        if shift_type == ShiftType.OFFICE:
            await notify_office_roster()
        else:
            await notify_shift_start(shift_type)

        db.add(ShiftNotificationLog(date=shift_date, shift_type=shift_type))
        await db.commit()
        logger.info("Shift notification sent: %s on %s", shift_type, shift_date)


async def schedule_pending_notifications(scheduler) -> int:
    """Query all future published shifts and register one-time jobs for their start times.

    Safe to call multiple times — skips already-scheduled and already-sent jobs.
    Returns the number of new jobs registered.
    """
    now = datetime.now(timezone.utc)
    today = now.date()
    scheduled = 0

    async with AsyncSessionFactory() as db:
        configs_result = await db.execute(
            select(ShiftConfig).where(ShiftConfig.is_active == True)
        )
        config_map: dict[ShiftType, ShiftConfig] = {
            c.shift_type: c for c in configs_result.scalars().all()
        }

        # All future (date, shift_type) pairs that are published
        pairs_result = await db.execute(
            select(Shift.date, Shift.shift_type)
            .distinct()
            .where(Shift.is_published == True, Shift.date >= today)
        )

        for shift_date, shift_type in pairs_result.all():
            config = config_map.get(shift_type)
            if not config or not config.default_start_time:
                continue

            fire_at = datetime.combine(shift_date, config.default_start_time, tzinfo=timezone.utc)
            if fire_at <= now:
                continue  # already in the past

            # Already notified?
            existing = await db.execute(
                select(ShiftNotificationLog).where(
                    ShiftNotificationLog.date == shift_date,
                    ShiftNotificationLog.shift_type == shift_type,
                )
            )
            if existing.scalar_one_or_none():
                continue

            job_id = f"shift_notif_{shift_type.value}_{shift_date.isoformat()}"
            if scheduler.get_job(job_id):
                continue  # already scheduled in memory

            scheduler.add_job(
                _fire_notification,
                "date",
                run_date=fire_at,
                id=job_id,
                args=[shift_type.value, shift_date.isoformat()],
                misfire_grace_time=300,  # fire up to 5 min late if server was briefly down
            )
            scheduled += 1
            logger.info(
                "Scheduled shift notification: %s on %s at %s UTC",
                shift_type.value, shift_date, fire_at.strftime("%H:%M"),
            )

    if scheduled:
        logger.info("Registered %d new shift notification job(s)", scheduled)
    return scheduled
