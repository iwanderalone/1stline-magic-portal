"""Main application entry point."""
import logging
import os
from datetime import time as dtime
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.types import ASGIApp, Receive, Send, Scope
from starlette.datastructures import MutableHeaders
from starlette.responses import Response

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import get_settings
from app.core.database import engine, Base, _is_sqlite, get_db
from app.core.security import hash_password
from app.core.scheduler import scheduler
from app.api import auth, users, groups, schedule, reminders, notifications, admin_config
from app.api import mail_reporter
from app.api import containers
from app.workers.reminder_worker import check_and_fire_reminders
from app.workers.shift_notification_scheduler import schedule_pending_notifications
from app.services.telegram_service import poll_telegram_updates
from app.services.mail_reporter_service import check_all_mailboxes
from app.api.containers import check_vps_offline

from app.core.logging_config import configure_logging
configure_logging()
logger = logging.getLogger(__name__)
settings = get_settings()


async def seed_defaults():
    """Create admin, demo users, and default shift configs."""
    from sqlalchemy import select
    from app.core.database import AsyncSessionFactory
    from app.models.models import User, UserRole, ShiftConfig, ShiftType, Group

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
        "ALTER TABLE email_logs ADD COLUMN is_solved INTEGER DEFAULT 0",
        "ALTER TABLE email_logs ADD COLUMN solver_comment TEXT",
        "ALTER TABLE email_logs ADD COLUMN solved_at DATETIME",
        "ALTER TABLE email_logs ADD COLUMN rule_id INTEGER REFERENCES mail_routing_rules(id) ON DELETE SET NULL",
        "ALTER TABLE email_logs ADD COLUMN status VARCHAR(20) DEFAULT 'unchecked'",
        # Telegram Templates
        "ALTER TABLE telegram_templates ADD COLUMN description TEXT",
        "ALTER TABLE telegram_templates ADD COLUMN topic_id INTEGER",
        # VPS Agents
        "ALTER TABLE vps_agents ADD COLUMN description TEXT",
        "ALTER TABLE vps_agents ADD COLUMN is_enabled INTEGER DEFAULT 1",
        "ALTER TABLE vps_agents ADD COLUMN hostname VARCHAR(255)",
        "ALTER TABLE vps_agents ADD COLUMN alert_template_id TEXT",
        # Container States
        "ALTER TABLE container_states ADD COLUMN is_absent INTEGER DEFAULT 0",
        "ALTER TABLE container_states ADD COLUMN display_name VARCHAR(100)",
        "ALTER TABLE container_states ADD COLUMN description TEXT",
        "ALTER TABLE container_states ADD COLUMN hosted_on VARCHAR(150)",
        "ALTER TABLE container_states ADD COLUMN last_logs TEXT",
        # Container Commands
        "ALTER TABLE container_commands ADD COLUMN container_name VARCHAR(255)",
        "ALTER TABLE container_commands ADD COLUMN result_message TEXT",
        # VPS Agent system snapshot & alert config
        "ALTER TABLE vps_agents ADD COLUMN system_snapshot TEXT",
        "ALTER TABLE vps_agents ADD COLUMN disk_alert_threshold INTEGER DEFAULT 85",
        # VPS Agent CPU + per-alert flags
        "ALTER TABLE vps_agents ADD COLUMN cpu_alert_threshold INTEGER DEFAULT 80",
        "ALTER TABLE vps_agents ADD COLUMN alert_flags TEXT",
        # Per-mailbox routing rule scope
        "ALTER TABLE mail_routing_rules ADD COLUMN mailbox_id INTEGER REFERENCES mailbox_configs(id) ON DELETE SET NULL",
        # B3: backfill status from is_solved, then drop redundant column
        "UPDATE email_logs SET status = 'solved' WHERE is_solved = 1 AND status = 'unchecked'",
        "ALTER TABLE email_logs DROP COLUMN is_solved",
    ]
    async with engine.begin() as conn:
        for stmt in migrations:
            try:
                await conn.execute(text(stmt))
            except Exception as e:
                msg = str(e).lower()
                # Additive migrations: "already exists" / "duplicate column" are expected
                if "already exists" not in msg and "duplicate column" not in msg:
                    logger.warning("Migration step may have failed: %s — stmt: %.80s", e, stmt)


async def seed_routing_rules():
    """Upsert built-in routing rules. Safe to run on every startup."""
    from sqlalchemy import select
    from app.core.database import AsyncSessionFactory
    from app.models.models import MailRoutingRule
    from app.services.mail_reporter_service import BUILTIN_RULES

    async with AsyncSessionFactory() as db:
        # Remove deprecated combined category — merged into onboarding
        dep = await db.execute(
            select(MailRoutingRule).where(MailRoutingRule.builtin_key == "onboarding_offboarding")
        )
        dep_rule = dep.scalar_one_or_none()
        if dep_rule:
            await db.delete(dep_rule)
            await db.commit()

        for rule_data in BUILTIN_RULES:
            key = rule_data["builtin_key"]
            result = await db.execute(
                select(MailRoutingRule).where(MailRoutingRule.builtin_key == key)
            )
            existing = result.scalar_one_or_none()
            if existing is None:
                db.add(MailRoutingRule(
                    is_builtin=True,
                    builtin_key=key,
                    name=rule_data["name"],
                    label=rule_data["label"],
                    color=rule_data["color"],
                    hashtag=rule_data.get("hashtag"),
                    mention_users=rule_data.get("mention_users"),
                    include_body=rule_data.get("include_body", True),
                    priority=rule_data.get("priority", 100),
                    enabled=True,
                ))
        await db.commit()
    logger.info("Built-in routing rules seeded")


async def _migrate_imap_passwords() -> None:
    """One-time migration: encrypt any remaining plaintext IMAP passwords."""
    from cryptography.fernet import InvalidToken
    from app.core.encryption import encrypt, decrypt
    from app.core.database import AsyncSessionFactory
    from app.models.models import MailboxConfig
    from sqlalchemy import select

    async with AsyncSessionFactory() as db:
        result = await db.execute(select(MailboxConfig))
        migrated = 0
        for mb in result.scalars().all():
            if not mb.password:
                continue
            try:
                decrypt(mb.password)  # Already encrypted — no-op
            except Exception:
                mb.password = encrypt(mb.password)  # Plaintext — encrypt it
                migrated += 1
        if migrated:
            await db.commit()
            logger.info("Encrypted %d IMAP passwords", migrated)


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
    await seed_routing_rules()
    await _migrate_imap_passwords()

    # Reminder worker
    scheduler.add_job(check_and_fire_reminders, "interval", seconds=30)

    # Shift notifications: schedule one-time jobs for each future published shift.
    # Re-runs on every startup so jobs survive server restarts.
    await schedule_pending_notifications(scheduler)

    if settings.TELEGRAM_BOT_TOKEN:
        scheduler.add_job(
            poll_telegram_updates, "interval", seconds=20,
            id="telegram_poll", max_instances=1, coalesce=True,
        )

    # Mail reporter — check all enabled mailboxes on a configurable interval
    scheduler.add_job(
        check_all_mailboxes, "interval", seconds=settings.MAIL_POLL_INTERVAL,
        id="mail_reporter_poll", max_instances=1, coalesce=True,
    )

    # VPS offline detection — runs every 60 s, fires when last_seen > 5 min ago
    scheduler.add_job(
        check_vps_offline, "interval", seconds=60,
        id="vps_offline_check", max_instances=1, coalesce=True,
    )

    scheduler.start()
    logger.info("Scheduler started: reminders (30s), shift notifications (pre-scheduled), mail reporter (%ds), vps offline check (60s)", settings.MAIL_POLL_INTERVAL)

    yield
    scheduler.shutdown()
    await engine.dispose()


app = FastAPI(title=settings.APP_NAME, version=settings.APP_VERSION, lifespan=lifespan)

# Middleware is applied in reverse registration order (last added = outermost = runs first).
# SecurityHeadersMiddleware is added after CORSMiddleware so it runs outermost,
# ensuring headers are set on every response including CORS preflights.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LimitBodySizeMiddleware:
    """Reject requests whose Content-Length exceeds MAX_BODY_BYTES.

    Checks Content-Length header only (not streaming bodies). Clients sending
    chunked transfer-encoding without Content-Length are not caught here — that
    is an acceptable trade-off for an internal portal with trusted clients.
    """
    MAX_BODY_BYTES = 1 * 1024 * 1024  # 1 MB

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] == "http":
            headers = dict(scope.get("headers", []))
            content_length_raw = headers.get(b"content-length")
            if content_length_raw is not None:
                try:
                    content_length = int(content_length_raw)
                except (ValueError, TypeError):
                    content_length = None
                if content_length is not None and content_length > self.MAX_BODY_BYTES:
                    response = Response(
                        content='{"detail": "Request body too large"}',
                        status_code=413,
                        media_type="application/json",
                    )
                    await response(scope, receive, send)
                    return
        await self.app(scope, receive, send)


class SecurityHeadersMiddleware:
    """Pure-ASGI security headers middleware.

    Injects security headers by wrapping the ASGI send callable rather than
    subclassing BaseHTTPMiddleware. This avoids the known Starlette issue where
    BaseHTTPMiddleware intercepts unhandled exceptions before FastAPI's exception
    handlers can log them.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_headers(message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers["X-Content-Type-Options"] = "nosniff"
                headers["X-Frame-Options"] = "DENY"
                headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
                headers["X-XSS-Protection"] = "0"
                headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
            await send(message)

        await self.app(scope, receive, send_with_headers)

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(LimitBodySizeMiddleware)

app.include_router(auth.router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(groups.router, prefix="/api")
app.include_router(schedule.router, prefix="/api")
app.include_router(reminders.router, prefix="/api")
app.include_router(notifications.router, prefix="/api")
app.include_router(admin_config.router, prefix="/api")
app.include_router(mail_reporter.router, prefix="/api")
app.include_router(containers.router, prefix="/api")


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception on %s %s", request.method, request.url, exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/api/health")
async def health(db: AsyncSession = Depends(get_db)):
    db_status = "ok"
    try:
        await db.execute(text("SELECT 1"))
    except Exception as e:
        logger.error("Health check: DB unreachable: %s", e)
        db_status = "error"
    status_code = 200 if db_status == "ok" else 503
    return JSONResponse(
        status_code=status_code,
        content={"status": "ok" if db_status == "ok" else "degraded",
                 "db": db_status,
                 "version": settings.APP_VERSION},
    )


@app.get("/api/config")
async def public_config():
    """Public config exposed to the frontend (no secrets)."""
    return {
        "telegram_bot_username": settings.TELEGRAM_BOT_USERNAME,
        "portal_timezone": settings.PORTAL_TIMEZONE,
    }


