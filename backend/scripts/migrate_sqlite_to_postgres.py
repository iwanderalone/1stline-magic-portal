#!/usr/bin/env python3
"""
Migrate data from an existing SQLite portal.db to a PostgreSQL database.

Usage:
    cd backend
    SQLITE_URL="sqlite+aiosqlite:////path/to/portal.db" \
    POSTGRES_URL="postgresql+asyncpg://portal:password@localhost:5432/portal" \
    SECRET_KEY="your-secret-key" \
    JWT_SECRET="your-jwt-secret" \
    python scripts/migrate_sqlite_to_postgres.py

Prerequisites:
    1. The PostgreSQL database must already have the schema applied:
       alembic upgrade head   (with DATABASE_URL pointing to PostgreSQL)
    2. The PostgreSQL database must be empty (no existing data).
"""
import asyncio
import os
import sys
import logging

# Must be set before importing app modules that call get_settings()
os.environ.setdefault("DATABASE_URL", os.environ.get("SQLITE_URL", ""))

import re

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import Table, select, text

# ── Ensure app is importable ──────────────────────────────────────────────────
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.models.models import (  # noqa: E402
    User, Group, user_groups, ShiftConfig, Shift, TimeOffRequest,
    Reminder, Notification, ActivityLog, TelegramChat, TelegramTemplate,
    ShiftNotificationLog, MailboxConfig, MailRoutingRule, EmailLog, EmailComment,
    VPSAgent, ContainerState, ContainerCommand,
)
from app.core.database import Base  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

SQLITE_URL = os.environ["SQLITE_URL"]
POSTGRES_URL = os.environ["POSTGRES_URL"]

# Tables in insertion order (dependencies first)
ORDERED_MODELS = [
    Group, User, user_groups,
    ShiftConfig, Shift, TimeOffRequest,
    Reminder, Notification, ActivityLog,
    TelegramChat, TelegramTemplate,
    ShiftNotificationLog,
    MailboxConfig, MailRoutingRule, EmailLog, EmailComment,
    VPSAgent, ContainerState, ContainerCommand,
]


async def copy_table(src_session: AsyncSession, dst_engine, model):
    """Copy all rows from src to dst for a given model or association table."""
    if isinstance(model, Table):
        # Association table (e.g. user_groups)
        table = model
        rows = (await src_session.execute(table.select())).fetchall()
        if not rows:
            return
        async with dst_engine.begin() as conn:
            await conn.execute(table.insert(), [dict(r._mapping) for r in rows])
        log.info("  %s: %d rows", table.name, len(rows))
        return

    # ORM model
    result = await src_session.execute(select(model))
    objects = result.scalars().all()
    if not objects:
        return

    # Convert ORM objects to plain dicts
    dicts = []
    for obj in objects:
        d = {}
        for col in model.__table__.columns:
            d[col.name] = getattr(obj, col.name)
        dicts.append(d)

    async with dst_engine.begin() as conn:
        await conn.execute(model.__table__.insert(), dicts)

    log.info("  %s: %d rows", model.__tablename__, len(dicts))


async def main():
    log.info("Source:      %s", SQLITE_URL)
    log.info("Destination: %s", re.sub(r":[^:@]+@", ":***@", POSTGRES_URL))

    src_engine = create_async_engine(SQLITE_URL, connect_args={"check_same_thread": False})
    dst_engine = create_async_engine(POSTGRES_URL, pool_size=5)

    src_factory = async_sessionmaker(src_engine, class_=AsyncSession, expire_on_commit=False)

    # Verify destination is empty
    async with dst_engine.connect() as conn:
        count = (await conn.execute(text("SELECT COUNT(*) FROM users"))).scalar()
        if count and count > 0:
            log.error("Destination database already has %d users. Aborting to avoid duplicates.", count)
            log.error("Drop and recreate the destination DB, then run `alembic upgrade head` first.")
            sys.exit(1)

    log.info("Starting migration...")
    async with src_factory() as src_session:
        for model in ORDERED_MODELS:
            name = getattr(model, "__tablename__", None) or getattr(model, "name", str(model))
            try:
                await copy_table(src_session, dst_engine, model)
            except Exception as e:
                log.error("Failed on %s: %s", name, e)
                raise

    # Reset PostgreSQL sequences for integer-PK tables after bulk insert.
    # Without this, the next app INSERT into these tables will collide with migrated IDs.
    int_pk_tables = ["mailbox_configs", "mail_routing_rules", "email_logs", "email_comments"]
    async with dst_engine.begin() as conn:
        for table_name in int_pk_tables:
            await conn.execute(text(
                f"SELECT setval(pg_get_serial_sequence('{table_name}', 'id'), "
                f"COALESCE((SELECT MAX(id) FROM {table_name}), 1))"
            ))
            log.info("  reset sequence for %s", table_name)

    await src_engine.dispose()
    await dst_engine.dispose()

    log.info("Migration complete.")


if __name__ == "__main__":
    asyncio.run(main())
