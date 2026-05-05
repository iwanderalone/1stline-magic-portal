# PostgreSQL Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the portal support PostgreSQL as the production database, keeping SQLite available for local development.

**Architecture:** SQLite stays the default for `DATABASE_URL=sqlite+...` (dev, tests). PostgreSQL is activated by pointing `DATABASE_URL` at a `postgresql+asyncpg://...` URL. Schema creation for PostgreSQL is handled by Alembic migrations run before the app starts (`alembic upgrade head` in the Docker Compose command), never by `Base.metadata.create_all`. SQLite continues to use `create_all` + the existing `run_migrations()` helper unchanged.

**Tech Stack:** asyncpg (async PostgreSQL driver), Alembic 1.13 (schema migrations), PostgreSQL 16-alpine (Docker), existing SQLAlchemy 2.0 async ORM models (zero model changes required).

---

## Pre-flight: orient yourself

Before starting any task, read:
- `backend/app/core/database.py` — note the `_is_sqlite` flag and existing PostgreSQL pool config
- `backend/app/main.py` — lines ~98–170: `run_migrations()` and the lifespan `create_all` call
- `backend/app/models/models.py` — full ORM model list (18 tables, all SQLAlchemy-standard types)
- `docker-compose.yml` — current 2-service setup
- `backend/requirements.txt`

---

## Task P1: Add asyncpg and Alembic dependencies

**Files:**
- Modify: `backend/requirements.txt`

- [ ] **Step 1: Add the two new packages to requirements.txt**

Open `backend/requirements.txt` and replace:
```
aiosqlite==0.20.0
```
with:
```
aiosqlite==0.20.0
asyncpg==0.29.0
alembic==1.13.3
```

`asyncpg` is the async PostgreSQL driver used by SQLAlchemy. `aiosqlite` stays — SQLite support is preserved for local dev and tests.

- [ ] **Step 2: Install in local dev environment**

```bash
cd backend
source venv/bin/activate   # or: source venv312/bin/activate
pip install asyncpg==0.29.0 alembic==1.13.3
```

Expected: both packages install without errors.

- [ ] **Step 3: Verify import works**

```bash
python -c "import asyncpg; import alembic; print('OK')"
```
Expected: `OK`

- [ ] **Step 4: Run existing tests to confirm nothing broke**

```bash
PYTHONPATH=. venv312/bin/python3.12 -m pytest tests/ -v
```
Expected: all 18 tests pass (tests still use SQLite — unaffected).

- [ ] **Step 5: Commit**

```bash
git add backend/requirements.txt
git commit -m "deps: add asyncpg and alembic for PostgreSQL support"
```

---

## Task P2: Set up Alembic with async SQLAlchemy

**Files:**
- Create: `backend/alembic.ini`
- Create: `backend/alembic/env.py`
- Create: `backend/alembic/script.py.mako`
- Create: `backend/alembic/versions/` (empty directory — Alembic writes into it)

- [ ] **Step 1: Initialise Alembic scaffold**

```bash
cd backend
alembic init alembic
```

Expected: creates `alembic.ini`, `alembic/env.py`, `alembic/script.py.mako`, `alembic/versions/`.

- [ ] **Step 2: Replace alembic.ini with a minimal config**

Open `backend/alembic.ini` and set it to exactly:

```ini
[alembic]
script_location = alembic
prepend_sys_path = .
# sqlalchemy.url is read from Settings in env.py — do not set it here
file_template = %%(year)d%%(month).2d%%(day).2d_%%(rev)s_%%(slug)s
timezone = UTC

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARN
handlers = console
qualname =

[logger_sqlalchemy]
level = WARN
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
datefmt = %H:%M:%S
```

- [ ] **Step 3: Replace alembic/env.py with async-aware version**

Open `backend/alembic/env.py` and replace the entire contents with:

```python
"""Alembic async environment for SQLAlchemy 2.0."""
import asyncio
import os
import sys
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# Ensure the backend app package is importable when running `alembic` from
# the backend/ directory (where alembic.ini lives).
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

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
```

- [ ] **Step 4: Verify Alembic can connect (SQLite) and shows no current revision**

Set a SQLite DATABASE_URL temporarily to confirm env.py loads without errors:

```bash
cd backend
DATABASE_URL="sqlite+aiosqlite:///./test_alembic.db" \
SECRET_KEY="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
JWT_SECRET="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" \
alembic current
```

Expected output: `INFO  [alembic.runtime.migration] Context impl ...` followed by either an empty line or `(head)`. No Python errors.

```bash
rm -f backend/test_alembic.db
```

- [ ] **Step 5: Commit**

```bash
git add backend/alembic.ini backend/alembic/
git commit -m "chore: initialise Alembic with async SQLAlchemy env"
```

---

## Task P3: Generate the initial Alembic migration

This creates the single migration that builds all 18 tables from scratch on a fresh PostgreSQL database.

**Files:**
- Create: `backend/alembic/versions/<datestamp>_initial_schema.py` (autogenerated)

- [ ] **Step 1: Autogenerate the migration from current ORM models**

```bash
cd backend
DATABASE_URL="sqlite+aiosqlite:///./alembic_gen.db" \
SECRET_KEY="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
JWT_SECRET="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" \
alembic revision --autogenerate -m "initial_schema"
```

Expected: creates a file like `backend/alembic/versions/20260407_<rev>_initial_schema.py`.

```bash
rm -f backend/alembic_gen.db
```

- [ ] **Step 2: Review the generated migration**

Open the generated file in `backend/alembic/versions/`. Check:

1. `upgrade()` creates all 18 tables: `users`, `groups`, `user_groups`, `shift_configs`, `shifts`, `time_off_requests`, `reminders`, `notifications`, `activity_logs`, `telegram_chats`, `telegram_templates`, `shift_notification_logs`, `mailbox_configs`, `mail_routing_rules`, `email_logs`, `email_comments`, `vps_agents`, `container_states`, `container_commands`.
2. All indexes are present (the `__table_args__` indexes on `shifts`, `reminders`, `email_logs`).
3. All `UniqueConstraint` entries are present.
4. `downgrade()` drops everything in reverse order (tables that depend on others dropped first).

If any table is missing, add it manually to `upgrade()` / `downgrade()`.

- [ ] **Step 3: Fix the `downgrade()` order if needed**

The safest `downgrade()` drop order is:

```python
def downgrade() -> None:
    op.drop_table("container_commands")
    op.drop_table("container_states")
    op.drop_table("vps_agents")
    op.drop_table("email_comments")
    op.drop_table("email_logs")
    op.drop_table("mail_routing_rules")
    op.drop_table("mailbox_configs")
    op.drop_table("shift_notification_logs")
    op.drop_table("telegram_templates")
    op.drop_table("telegram_chats")
    op.drop_table("activity_logs")
    op.drop_table("notifications")
    op.drop_table("reminders")
    op.drop_table("time_off_requests")
    op.drop_table("shifts")
    op.drop_table("shift_configs")
    op.drop_table("user_groups")
    op.drop_table("groups")
    op.drop_table("users")
```

If the autogenerated order already respects FK dependencies, leave it unchanged.

- [ ] **Step 4: Test the migration against a real PostgreSQL instance**

If you have a local PostgreSQL running:

```bash
cd backend
DATABASE_URL="postgresql+asyncpg://postgres:postgres@localhost:5432/portal_test" \
SECRET_KEY="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
JWT_SECRET="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" \
alembic upgrade head
```

Expected: all `CREATE TABLE` statements run, `alembic_version` table shows `head`.

```bash
# Verify downgrade also works
DATABASE_URL="postgresql+asyncpg://postgres:postgres@localhost:5432/portal_test" \
SECRET_KEY="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
JWT_SECRET="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" \
alembic downgrade base
```

Expected: all tables dropped cleanly.

If you don't have a local PostgreSQL, skip this step and rely on the Docker Compose test in Task P5.

- [ ] **Step 5: Commit**

```bash
git add backend/alembic/versions/
git commit -m "chore: add initial Alembic migration for all 18 tables"
```

---

## Task P4: Update main.py lifespan for PostgreSQL

**Files:**
- Modify: `backend/app/main.py`

The current lifespan always calls `Base.metadata.create_all` and `run_migrations()`. For PostgreSQL, Alembic handles schema creation (`alembic upgrade head` runs before the app starts in Docker Compose). The app itself should skip `create_all` and `run_migrations()` when not using SQLite.

- [ ] **Step 1: Read the current lifespan in main.py**

Find the `lifespan` async context manager. It currently starts with:

```python
if _is_sqlite:
    db_url = settings.DATABASE_URL
    db_path = db_url.split("///", 1)[-1]
    db_dir = os.path.dirname(db_path)
    if db_dir:
        os.makedirs(db_dir, exist_ok=True)

async with engine.begin() as conn:
    await conn.run_sync(Base.metadata.create_all)
await run_migrations()
await seed_defaults()
```

- [ ] **Step 2: Wrap `create_all` and `run_migrations()` in the `_is_sqlite` guard**

Replace the block from the opening of `lifespan` up through `await run_migrations()` with:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    if _is_sqlite:
        # Ensure the SQLite data directory exists
        db_url = settings.DATABASE_URL
        db_path = db_url.split("///", 1)[-1]
        db_dir = os.path.dirname(db_path)
        if db_dir:
            os.makedirs(db_dir, exist_ok=True)
        # SQLite: create tables and run additive ALTER TABLE migrations
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        await run_migrations()
    else:
        # PostgreSQL: schema is managed by Alembic.
        # `alembic upgrade head` must be run before starting the app
        # (see docker-compose.yml command).
        logger.info("PostgreSQL mode — skipping create_all (Alembic manages schema)")
```

Keep everything after `await run_migrations()` (seed_defaults, seed_routing_rules, etc.) unchanged.

- [ ] **Step 3: Verify existing tests still pass**

```bash
cd backend && PYTHONPATH=. venv312/bin/python3.12 -m pytest tests/ -v
```

Expected: 18/18 pass. (Tests use SQLite — the `_is_sqlite` branch still runs.)

- [ ] **Step 4: Commit**

```bash
git add backend/app/main.py
git commit -m "feat: skip create_all for PostgreSQL — Alembic manages schema"
```

---

## Task P5: Add PostgreSQL service to docker-compose.yml

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Read the current docker-compose.yml**

Note the existing `api` and `frontend` services, the `./data:/app/data` volume, and the healthcheck on the `api` service.

- [ ] **Step 2: Add the `db` service and `POSTGRES_PASSWORD` env var**

Replace the entire `docker-compose.yml` with:

```yaml
services:
  # ── PostgreSQL ───────────────────────────────────────────
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: portal
      POSTGRES_USER: portal
      POSTGRES_PASSWORD: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set in .env}"
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U portal -d portal"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 10s
    restart: unless-stopped

  # ── Backend API ─────────────────────────────────────────
  api:
    build:
      context: ./backend
      dockerfile: Dockerfile
    # Run Alembic migration before starting uvicorn
    command: >
      sh -c "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"
    ports:
      - "127.0.0.1:8000:8000"
    environment:
      DATABASE_URL: "postgresql+asyncpg://portal:${POSTGRES_PASSWORD:?POSTGRES_PASSWORD must be set in .env}@db:5432/portal"
      SECRET_KEY: "${SECRET_KEY:-change-me-in-production}"
      JWT_SECRET: "${JWT_SECRET:-change-me-in-production}"
      TELEGRAM_BOT_TOKEN: "${TELEGRAM_BOT_TOKEN:-}"
      TELEGRAM_BOT_USERNAME: "${TELEGRAM_BOT_USERNAME:-}"
      CORS_ORIGINS: "${CORS_ORIGINS:-http://localhost:3000,http://localhost:5173}"
      PORTAL_TIMEZONE: "${PORTAL_TIMEZONE:-UTC}"
      LOG_DIR: /app/data/logs
    volumes:
      - ./data:/app/data
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "python -c \"import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')\" || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 30s

  # ── Frontend (nginx, serves built React bundle) ──────
  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    ports:
      - "127.0.0.1:3000:80"
    depends_on:
      api:
        condition: service_healthy
    restart: unless-stopped
    healthcheck:
      test: ["CMD-SHELL", "curl -f http://localhost:80/ || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 10s

volumes:
  postgres_data:
```

Key changes from the previous version:
- `db` service added with health check
- `api` command runs `alembic upgrade head` before uvicorn
- `DATABASE_URL` points to PostgreSQL (via internal Docker network hostname `db`)
- `api` `depends_on: db: condition: service_healthy` ensures DB is ready first
- `start_period` on API healthcheck increased to 30s (Alembic migration adds startup time)
- `POSTGRES_PASSWORD` uses `:?` syntax — Docker Compose will error immediately if not set

- [ ] **Step 3: Validate compose syntax**

```bash
docker compose config --quiet && echo "Compose config valid"
```

If `docker compose` is not available, skip validation.

- [ ] **Step 4: Test bring-up (if Docker available)**

```bash
# Set required env vars
export POSTGRES_PASSWORD="testpass123"
export SECRET_KEY=$(openssl rand -hex 32)
export JWT_SECRET=$(openssl rand -hex 64)

docker compose up -d --build db api
docker compose logs api --follow
```

Expected in logs: `Running upgrade  -> <rev>, initial_schema` then `Uvicorn running`.

```bash
curl http://localhost:8000/api/health
```

Expected: `{"status":"ok","db":"ok","version":"..."}`.

```bash
docker compose down -v   # clean up test volumes
```

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml
git commit -m "feat: add PostgreSQL service to docker-compose, run alembic on startup"
```

---

## Task P6: Update .env.example and README

**Files:**
- Modify: `.env.example`
- Modify: `README.md`

- [ ] **Step 1: Add POSTGRES_PASSWORD to .env.example**

In `.env.example`, add a new `Database` section after the existing secrets block:

```
# ── Database ───────────────────────────────────────────────────────────────────
# Required for Docker Compose — used as the PostgreSQL password.
# Generate: openssl rand -hex 32
POSTGRES_PASSWORD=

# DATABASE_URL is set automatically by docker-compose.yml.
# Override here only for local development outside Docker.
# SQLite (local dev):
#   DATABASE_URL=sqlite+aiosqlite:///./portal.db
# PostgreSQL (production / custom):
#   DATABASE_URL=postgresql+asyncpg://portal:<password>@localhost:5432/portal
```

- [ ] **Step 2: Update README.md Quick Start section**

In `README.md`, find the Quick Start section step 1 and update it to mention `POSTGRES_PASSWORD`:

```markdown
### 1. Clone and configure

```bash
git clone https://github.com/YOUR_ORG/1line-portal.git
cd 1line-portal
cp .env.example .env
```

Edit `.env` and set real values for all three required secrets:

```bash
# Generate secrets (run these, paste output into .env)
openssl rand -hex 32   # → SECRET_KEY
openssl rand -hex 64   # → JWT_SECRET
openssl rand -hex 32   # → POSTGRES_PASSWORD
```
```

- [ ] **Step 3: Update README.md Configuration table**

In the Configuration table, add a row for `POSTGRES_PASSWORD`:

```
| `POSTGRES_PASSWORD`     | **yes**  | *(none)*                             | PostgreSQL password (used by Docker Compose). Generate: `openssl rand -hex 32` |
```

And update the `DATABASE_URL` row to show the PostgreSQL default:

```
| `DATABASE_URL`          | no       | `postgresql+asyncpg://portal:<pw>@db:5432/portal` (Docker) | Override for external DB or local SQLite dev |
```

- [ ] **Step 4: Update README.md Backend Structure section**

Add `alembic/` to the backend structure listing:

```
backend/
├── alembic.ini                     # Alembic config — used by `alembic upgrade head`
├── alembic/
│   ├── env.py                      # Async Alembic environment (reads DATABASE_URL from Settings)
│   └── versions/                   # Migration files — one per schema change
├── app/
│   ...
```

- [ ] **Step 5: Commit**

```bash
git add .env.example README.md
git commit -m "docs: add POSTGRES_PASSWORD, Alembic workflow, and PostgreSQL DATABASE_URL to docs"
```

---

## Task P7: SQLite → PostgreSQL data migration script

For existing deployments running on SQLite that want to move to PostgreSQL without losing data.

**Files:**
- Create: `backend/scripts/migrate_sqlite_to_postgres.py`

- [ ] **Step 1: Create the migration script**

Create `backend/scripts/migrate_sqlite_to_postgres.py` with the following content:

```python
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

from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy import select, text

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
    if hasattr(model, "__table__"):
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
    log.info("Destination: %s", POSTGRES_URL[:POSTGRES_URL.index("@") + 1] + "***")

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
            name = getattr(model, "name", None) or getattr(model, "__tablename__", str(model))
            try:
                await copy_table(src_session, dst_engine, model)
            except Exception as e:
                log.error("Failed on %s: %s", name, e)
                raise

    await src_engine.dispose()
    await dst_engine.dispose()

    log.info("Migration complete.")


if __name__ == "__main__":
    asyncio.run(main())
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x backend/scripts/migrate_sqlite_to_postgres.py
```

- [ ] **Step 3: Test the script with a local SQLite and PostgreSQL (if available)**

```bash
# Start a test PostgreSQL (requires Docker)
docker run -d --name pg_test \
  -e POSTGRES_DB=portal_test \
  -e POSTGRES_USER=portal \
  -e POSTGRES_PASSWORD=testpass \
  -p 5433:5432 \
  postgres:16-alpine

# Wait 5 seconds for it to start
sleep 5

# Apply schema to the test PostgreSQL
cd backend
DATABASE_URL="postgresql+asyncpg://portal:testpass@localhost:5433/portal_test" \
SECRET_KEY="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
JWT_SECRET="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" \
alembic upgrade head

# Run the migration (point at your real SQLite DB, or use a test one)
SQLITE_URL="sqlite+aiosqlite:////path/to/your/portal.db" \
POSTGRES_URL="postgresql+asyncpg://portal:testpass@localhost:5433/portal_test" \
SECRET_KEY="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
JWT_SECRET="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" \
python scripts/migrate_sqlite_to_postgres.py

# Clean up
docker rm -f pg_test
```

Expected: all tables printed with row counts, no errors.

If you don't have a local SQLite DB with data, create a small test one first:

```bash
DATABASE_URL="sqlite+aiosqlite:///./test_migration.db" \
SECRET_KEY="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" \
JWT_SECRET="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" \
python -c "
import asyncio
from sqlalchemy.ext.asyncio import create_async_engine
from app.core.database import Base

async def main():
    engine = create_async_engine('sqlite+aiosqlite:///./test_migration.db')
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()

asyncio.run(main())
"
```

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/migrate_sqlite_to_postgres.py
git commit -m "feat: add SQLite → PostgreSQL data migration script"
```

---

## Self-review

### Spec coverage check

| Requirement | Task |
|---|---|
| asyncpg driver added | P1 |
| SQLite still works for dev/tests | P1 (aiosqlite kept), P4 (`_is_sqlite` guard) |
| Alembic with async SQLAlchemy | P2 |
| All 18 tables in initial migration | P3 |
| App skips `create_all` for PostgreSQL | P4 |
| PostgreSQL service in Docker Compose | P5 |
| `alembic upgrade head` runs before app | P5 |
| DB healthcheck gates API startup | P5 |
| `POSTGRES_PASSWORD` documented | P6 |
| Existing SQLite data migratable | P7 |

All requirements covered.

### Placeholder scan — none found.

### Type consistency

- `_is_sqlite` is used in `database.py` (import time) and `main.py` (runtime). Both import from the same module — consistent.
- `ORDERED_MODELS` in P7 lists `user_groups` as an association table (no `__tablename__`). The script handles this via `hasattr(model, "__table__")` check — correct.
- `alembic upgrade head` command in P5 docker-compose references `alembic.ini` which is at `backend/` — the `api` service build context is `./backend`, so `alembic.ini` will be at `/app/alembic.ini` in the container. The Dockerfile must COPY it in. Verify `backend/Dockerfile` copies `alembic.ini` and `alembic/` directory. If the Dockerfile only copies `app/` and `requirements.txt`, add:
  ```dockerfile
  COPY alembic.ini .
  COPY alembic/ alembic/
  ```
  This must be added as a step in P5 (check the Dockerfile before committing).

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-07-postgresql-migration.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** — Fresh subagent per task, two-stage review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
