"""Main application entry point."""
import logging
import os
from datetime import time as dtime
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.core.config import get_settings
from app.core.database import engine, Base, _is_sqlite
from app.core.security import hash_password
from app.api import auth, users, groups, schedule, reminders, notifications, admin_config
from app.workers.reminder_worker import check_and_fire_reminders
from app.services.telegram_service import notify_shift_start, notify_office_roster, poll_telegram_updates
from app.models.models import ShiftType

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
settings = get_settings()
scheduler = AsyncIOScheduler()


async def seed_defaults():
    """Create admin, demo users, and default shift configs."""
    from sqlalchemy import select
    from app.core.database import AsyncSessionFactory
    from app.models.models import User, UserRole, ShiftConfig, Group

    async with AsyncSessionFactory() as db:
        # Default admin
        result = await db.execute(select(User).where(User.role == UserRole.ADMIN).limit(1))
        if result.scalar_one_or_none() is None:
            admin = User(
                username="admin", display_name="Admin",
                hashed_password=hash_password("admin123"),
                role=UserRole.ADMIN,
            )
            db.add(admin)

            for name in ["Alice", "Bob", "Carol", "Dave", "Eve"]:
                db.add(User(
                    username=name.lower(), display_name=name,
                    hashed_password=hash_password("engineer123"),
                    role=UserRole.ENGINEER, min_shift_gap_days=2, max_shifts_per_week=3,
                ))

            # Default group
            g = Group(name="Team Alpha", description="Default support team", color="#6366f1")
            db.add(g)
            logger.info("Created default admin, engineers, and group")

        # Default shift configs
        result = await db.execute(select(ShiftConfig).limit(1))
        if result.scalar_one_or_none() is None:
            configs = [
                ShiftConfig(
                    shift_type=ShiftType.DAY, label="Day Shift",
                    duration_hours=12, default_start_time=dtime(8, 0),
                    default_end_time=dtime(20, 0), color="#f59e0b",
                    emoji="☀️", requires_location=False,
                ),
                ShiftConfig(
                    shift_type=ShiftType.NIGHT, label="Night Shift",
                    duration_hours=12, default_start_time=dtime(20, 0),
                    default_end_time=dtime(8, 0), color="#6366f1",
                    emoji="🌙", requires_location=False,
                ),
                ShiftConfig(
                    shift_type=ShiftType.OFFICE, label="Office Shift",
                    duration_hours=8, default_start_time=dtime(9, 0),
                    default_end_time=dtime(17, 0), color="#10b981",
                    emoji="🏢", requires_location=True,
                ),
            ]
            for c in configs:
                db.add(c)
            logger.info("Created default shift configs")

        await db.commit()


async def run_migrations():
    """Apply additive schema migrations (safe to run on every startup)."""
    from sqlalchemy import text
    if not _is_sqlite:
        return  # PostgreSQL users should use Alembic
    migrations = [
        "ALTER TABLE users ADD COLUMN timezone VARCHAR(50) DEFAULT 'UTC'",
        "ALTER TABLE users ADD COLUMN name_color VARCHAR(7) DEFAULT '#2563eb'",
        "ALTER TABLE users ADD COLUMN avatar_url VARCHAR(500)",
        "ALTER TABLE users ADD COLUMN otp_secret VARCHAR(32)",
        "ALTER TABLE users ADD COLUMN otp_enabled INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN telegram_notify_shifts INTEGER DEFAULT 1",
        "ALTER TABLE users ADD COLUMN telegram_notify_reminders INTEGER DEFAULT 1",
        "ALTER TABLE users ADD COLUMN telegram_link_code VARCHAR(20)",
        "ALTER TABLE users ADD COLUMN telegram_chat_id VARCHAR(50)",
        "ALTER TABLE users ADD COLUMN telegram_username VARCHAR(100)",
        "ALTER TABLE users ADD COLUMN updated_at DATETIME",
        "ALTER TABLE reminders ADD COLUMN telegram_target VARCHAR(10) DEFAULT 'personal'",
        "ALTER TABLE users ADD COLUMN allowed_shift_types TEXT",
    ]
    async with engine.begin() as conn:
        for stmt in migrations:
            try:
                await conn.execute(text(stmt))
            except Exception:
                pass  # Column already exists — safe to ignore


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure the data directory exists (needed for the SQLite file path)
    if _is_sqlite:
        db_url = settings.DATABASE_URL
        # Extract file path from sqlite+aiosqlite:///path
        db_path = db_url.split("///", 1)[-1]
        db_dir = os.path.dirname(db_path)
        if db_dir:
            os.makedirs(db_dir, exist_ok=True)

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await run_migrations()
    await seed_defaults()

    # Reminder worker
    scheduler.add_job(check_and_fire_reminders, "interval", seconds=30)

    # Shift start notifications (configurable times)
    scheduler.add_job(
        lambda: notify_shift_start(ShiftType.DAY),
        "cron", hour=7, minute=45, id="day_shift_notify"
    )
    scheduler.add_job(
        lambda: notify_shift_start(ShiftType.NIGHT),
        "cron", hour=19, minute=45, id="night_shift_notify"
    )
    scheduler.add_job(
        notify_office_roster,
        "cron", hour=8, minute=50, id="office_roster_notify"
    )

    if settings.TELEGRAM_BOT_TOKEN:
        scheduler.add_job(poll_telegram_updates, "interval", seconds=3, id="telegram_poll")

    scheduler.start()
    logger.info("Scheduler started: reminders (30s), shift notifications (daily)")

    yield
    scheduler.shutdown()
    await engine.dispose()


app = FastAPI(title=settings.APP_NAME, version=settings.APP_VERSION, lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(groups.router, prefix="/api")
app.include_router(schedule.router, prefix="/api")
app.include_router(reminders.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")
app.include_router(admin_config.router, prefix="/api")


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception on %s %s", request.method, request.url, exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/api/health")
async def health():
    return {"status": "ok", "version": settings.APP_VERSION}


@app.get("/api/config")
async def public_config():
    """Public config values the frontend needs at runtime (no auth required)."""
    return {"telegram_bot_username": settings.TELEGRAM_BOT_USERNAME}
