"""Alembic async environment for SQLAlchemy 2.0."""
import asyncio
import os
import sys
from logging.config import fileConfig

# Ensure the backend app package is importable when running `alembic` from
# the backend/ directory (where alembic.ini lives).
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# Import Base (triggers model registration) and all models so Alembic
# can introspect target_metadata.
from app.core.database import Base  # noqa: E402
from app.models import models  # noqa: E402, F401

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _get_url() -> str:
    """Read DATABASE_URL from settings (honours .env file)."""
    # Lazy import — avoids pulling in the full app at import time.
    from app.core.config import get_settings
    return get_settings().DATABASE_URL


def run_migrations_offline() -> None:
    """Generate SQL script without connecting to the DB (--sql mode)."""
    url = _get_url()
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


def _do_run_migrations(connection: Connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
    )
    with context.begin_transaction():
        context.run_migrations()


async def _run_async_migrations() -> None:
    url = _get_url()
    connectable = async_engine_from_config(
        {"sqlalchemy.url": url},
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(_do_run_migrations)
    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations against a live database connection."""
    asyncio.run(_run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
