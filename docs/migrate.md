# SQLite → PostgreSQL Migration

Migrate your existing production portal data from SQLite (`portal.db`) to PostgreSQL.
Run this **once** when switching production to the `feat/postgresql-migration` branch.

The script copies every table in dependency order, then resets PostgreSQL sequences so
new inserts don't collide with migrated IDs.

---

## Prerequisites

- The new `docker-compose.yml` (PostgreSQL branch) is **not yet running** — or is running
  with an **empty** database. The script aborts if it finds existing users.
- Python 3.12 with a backend virtualenv, or run the script from inside the API container.
- Your existing `data/portal.db` is accessible on the machine where you run the script.

---

## Step 1 — Back up SQLite first

```bash
cp data/portal.db data/portal.db.bak
```

Do this before touching anything. If anything goes wrong you can restore from the backup.

---

## Step 2 — Start the new stack (schema only, no data yet)

```bash
# On the feat/postgresql-migration branch
docker compose up -d --build
```

Alembic runs on startup and creates all tables. The database is empty at this point —
that is exactly what we need.

Verify PostgreSQL is up:

```bash
docker compose exec db psql -U portal -d portal -c "\dt"
```

You should see all tables listed with zero rows.

---

## Step 3 — Run the migration script

The script needs direct access to the PostgreSQL port. By default, the `db` service is
not exposed to the host. Use one of these two approaches:

### Option A — run inside the API container (recommended)

```bash
docker compose exec api bash

# Inside the container:
SQLITE_URL="sqlite+aiosqlite:////app/data/portal.db" \
POSTGRES_URL="postgresql+asyncpg://portal:${POSTGRES_PASSWORD}@db:5432/portal" \
SECRET_KEY="${SECRET_KEY}" \
JWT_SECRET="${JWT_SECRET}" \
python scripts/migrate_sqlite_to_postgres.py

exit
```

The container already has the venv, the app code, and access to both the SQLite file
(via the `./data:/app/data` volume) and the `db` service (via the internal Docker network).

### Option B — run from the host with a temporary port exposure

Add `ports: ["127.0.0.1:5432:5432"]` to the `db` service in `docker-compose.yml`,
restart (`docker compose up -d`), then run from the host:

```bash
cd backend
source venv/bin/activate   # or: source venv312/bin/activate

SQLITE_URL="sqlite+aiosqlite:////absolute/path/to/data/portal.db" \
POSTGRES_URL="postgresql+asyncpg://portal:<POSTGRES_PASSWORD>@127.0.0.1:5432/portal" \
SECRET_KEY="<your-secret-key>" \
JWT_SECRET="<your-jwt-secret>" \
python scripts/migrate_sqlite_to_postgres.py
```

Remove the temporary `ports:` entry again when done.

---

## Step 4 — Verify

Check row counts in PostgreSQL match what was in SQLite:

```bash
docker compose exec db psql -U portal -d portal -c "
  SELECT schemaname, tablename, n_live_tup AS rows
  FROM pg_stat_user_tables
  ORDER BY tablename;
"
```

Cross-check against SQLite:

```bash
sqlite3 data/portal.db "SELECT name FROM sqlite_master WHERE type='table';" | \
  while read t; do echo "$t: $(sqlite3 data/portal.db "SELECT COUNT(*) FROM $t")"; done
```

---

## Step 5 — Smoke test

Log in to the portal, check that users, shifts, mailboxes, and routing rules are all
present. Send a test Telegram notification if applicable.

---

## What the script does

1. Connects to both SQLite (source) and PostgreSQL (destination).
2. Aborts if the destination `users` table already has rows.
3. Copies every table in dependency order:
   `groups → users → user_groups → shift_configs → shifts → time_off_requests →
   reminders → notifications → activity_logs → telegram_chats → telegram_templates →
   shift_notification_logs → mailbox_configs → mail_routing_rules → email_logs →
   email_comments → vps_agents → container_states → container_commands`
4. Resets PostgreSQL auto-increment sequences for integer-PK tables so new inserts
   pick up from the correct next ID.

---

## Rollback

If something goes wrong after migration, the SQLite backup is at `data/portal.db.bak`.
To roll back to the SQLite branch:

```bash
# Stop the PostgreSQL stack
docker compose down

# Restore backup
cp data/portal.db.bak data/portal.db

# Check out the old branch and restart
git checkout main
docker compose up -d --build   # old sqlite-based stack
```
