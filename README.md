# 1line-portal — Support Team Internal Portal

A lightweight internal operations portal for first-line support teams. Provides shift scheduling, time-off management, IMAP email monitoring with Telegram delivery, and an in-app notification centre.

## Architecture

```
┌──────────────────────────────────────────────┐
│  React 18 + Vite 5  (SPA, CSS-in-JS)         │
│  No router library — page state in App.jsx   │
└───────────────────┬──────────────────────────┘
                    │ REST / JSON
┌───────────────────▼──────────────────────────┐
│  FastAPI 0.115  (Python 3.12)                 │
│  JWT auth · RBAC · APScheduler (in-process)  │
├──────────────────────────────────────────────┤
│  Modules:                                     │
│  · Auth          (login + TOTP 2FA)           │
│  · Users         (admin CRUD + profile)       │
│  · Groups        (team groupings)             │
│  · Schedule      (shifts + auto-generation)  │
│  · Time Off      (requests + approval)        │
│  · Mail Reporter (IMAP → classify → Telegram) │
│  · Notifications (in-app + Telegram)          │
│  · Admin config  (shift types, Telegram chats)│
└────────────┬──────────────────────────────────┘
             │
   ┌─────────▼──────────┐
   │  PostgreSQL        │
   │  (asyncpg)         │
   │  Docker: db:5432   │
   └────────────────────┘
          │
   ┌──────▼───────┐
   │ Telegram      │
   │ Bot API       │
   │ (optional)    │
   └──────────────┘
```

**Docker Compose runs PostgreSQL** (asyncpg driver, `postgres:16-alpine`). Schema is managed by Alembic — `alembic upgrade head` runs automatically before uvicorn starts.

## Quick Start

### 1. Clone and configure

```bash
git clone https://github.com/YOUR_ORG/1line-portal.git
cd 1line-portal
cp .env.example .env
```

Edit `.env` and set real values:

```bash
# Generate secrets (run these, paste output into .env)
openssl rand -hex 32   # → SECRET_KEY
openssl rand -hex 64   # → JWT_SECRET
openssl rand -hex 32   # → POSTGRES_PASSWORD
```

For a VPS deployment also set `CORS_ORIGINS` in `.env`:

```
CORS_ORIGINS=http://YOUR_SERVER_IP,https://portal.example.com
```

### 2. Create the data directory

```bash
mkdir -p data
```

The `./data` directory is mounted into the container for log files (`LOG_DIR=/app/data/logs`). PostgreSQL data is stored in the `postgres_data` named Docker volume.

### 3. Start with Docker Compose

```bash
docker-compose up -d --build
```

| Service  | Port | URL                        |
|----------|------|----------------------------|
| Frontend | 80   | http://YOUR_SERVER_IP      |
| API      | 8000 | http://YOUR_SERVER_IP:8000 |
| API docs | 8000 | http://YOUR_SERVER_IP:8000/docs |

The frontend is built into a static bundle served by nginx. nginx also proxies `/api` requests to the backend.

On first startup the database is created automatically and seeded with default accounts and shift configurations.

### 4. Or run locally (without Docker)

**Backend:**
```bash
cd backend
python -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev      # Vite dev server on :5173 — proxies /api to :8000
```

### 5. Default accounts

| Username | Password      | Role     |
|----------|---------------|----------|
| admin    | admin123      | Admin    |
| alice    | engineer123   | Engineer |
| bob      | engineer123   | Engineer |
| carol    | engineer123   | Engineer |
| dave     | engineer123   | Engineer |
| eve      | engineer123   | Engineer |

**Change these immediately in production.**

## Modules

### Auth
- Username/password login with bcrypt hashing
- Optional TOTP two-factor auth (Google Authenticator, Authy)
- JWT: 30-minute access token + 7-day refresh token
- OTP setup/disable via self-service profile page

### Schedule
- Weekly and monthly calendar views
- Three shift types: Day (08:00–20:00), Night (20:00–08:00), Office (09:00–17:00)
- **Auto-generation**: one-click schedule creation with hard constraints:
  - Minimum gap between shifts per user (configurable)
  - Maximum shifts per week per user (configurable)
  - Respects approved time-off requests
  - Optional availability cycle patterns (e.g. "works 24h elsewhere, then 3 days free")
  - Greedy workload balancing with random tie-breaking
- Draft → Published workflow (admin publishes, engineers see only published shifts)

### Time Off
- Standalone page for submitting and tracking time-off requests
- Types: Day off / Vacation / Sick leave with date range and optional note
- Admin approve/reject workflow; approved days block schedule auto-generation

### Mail Reporter
- Monitor one or more IMAP mailboxes (Yandex by default, configurable)
- Automatically classifies incoming emails by category using built-in rules + admin-defined custom rules
- Forwards formatted messages to Telegram chats/topics with category labels, hashtags, and @mentions
- Built-in categories: Adobe verification codes (extracts numeric code), Yandex 360 Support, Onboarding, Offboarding, General catch-all
- Custom rules: keyword, subject keyword, sender address, or sender domain matching
- Deduplication by message fingerprint — each email is processed exactly once
- Solve workflow: team members can mark emails as solved and add a comment from the UI
- Per-mailbox subject filter, Telegram target (chat_id:thread_id), enable/disable toggle
- Per-rule Telegram target override (route different categories to different channels/topics)
- Admin can trigger an immediate poll or test IMAP connection from the UI

### Telegram Bot
- Link portal accounts via short verification code (`/link <CODE>`)
- Bot commands: `/link <code>`, `/myshift`
- Shift start notifications sent at the configured start time for each shift type
- Group chat notifications (day shift, night shift, office roster) configurable per chat
- Forum topic support for group channels
- Setup: create a bot via @BotFather, set `TELEGRAM_BOT_TOKEN` in `.env`

### Notifications
- In-app notification centre (bell icon)
- Unread count polled every 15 seconds
- Mark individual or all notifications as read; clear all

### Admin Panel (admin role only)
- **Users tab**: create, edit, deactivate users; reset passwords and 2FA; generate Telegram link codes
- **Groups tab**: manage team groupings; assign members
- **Shift config tab**: edit shift type labels, durations, times, emoji, colours, location requirement
- **Telegram tab**: configure group chats and which notification types they receive
- **Telegram Templates tab**: named presets for Telegram destinations (used by mail rules and reminders)
- **Logs tab**: last 200 audit log entries (login, time-off, schedule generation/publish, etc.)

### Profile (self-service)
- Change display name, name colour, avatar URL
- Set timezone (IANA, e.g. `Europe/London`)
- Telegram username and per-notification-type preferences
- Enable/disable TOTP 2FA

## API Endpoints

```
POST   /api/auth/login                       # Step 1: credentials
POST   /api/auth/verify-otp                  # Step 2: OTP (if enabled)
POST   /api/auth/setup-otp                   # Generate QR code
POST   /api/auth/confirm-otp                 # Enable OTP
POST   /api/auth/disable-otp                 # Disable OTP
POST   /api/auth/refresh                     # Refresh tokens
GET    /api/auth/me                          # Current user
PATCH  /api/auth/me                          # Self-service profile update

GET    /api/users/                           # List all users (any role)
POST   /api/users/                           # Create user (admin)
POST   /api/users/me/telegram-link-code      # Generate own Telegram link code
POST   /api/users/me/telegram-unlink         # Unlink own Telegram account
PATCH  /api/users/:id                        # Update user (admin)
DELETE /api/users/:id                        # Deactivate user (admin)
DELETE /api/users/:id/hard                   # Permanently delete user (admin)
POST   /api/users/:id/reactivate             # Reactivate user (admin)
POST   /api/users/:id/reset-password         # Reset password (admin)
POST   /api/users/:id/telegram-link-code     # Generate link code for user (admin)
POST   /api/users/:id/reset-otp              # Disable 2FA for user (admin)

GET    /api/groups/                          # List groups
POST   /api/groups/                          # Create group (admin)
DELETE /api/groups/:id                       # Delete group (admin)

GET    /api/schedule/shift-configs           # Active shift type configs
GET    /api/schedule/shifts                  # ?start_date=&end_date=
POST   /api/schedule/shifts                  # Create shift (admin)
PATCH  /api/schedule/shifts/:id              # Update shift (admin)
DELETE /api/schedule/shifts/:id              # Delete shift (admin)
DELETE /api/schedule/shifts/drafts           # Clear drafts in range (admin)
POST   /api/schedule/generate                # Auto-generate schedule (admin)
POST   /api/schedule/publish                 # Publish draft shifts (admin)
GET    /api/schedule/time-off                # List time-off requests
POST   /api/schedule/time-off                # Submit time-off request
PATCH  /api/schedule/time-off/:id            # Approve/reject request (admin)
DELETE /api/schedule/time-off/:id            # Withdraw / delete request

GET    /api/reminders/                       # All reminders for current user
GET    /api/reminders/active                 # Active reminders only
POST   /api/reminders/                       # Create reminder
PATCH  /api/reminders/:id                    # Update reminder
DELETE /api/reminders/:id                    # Cancel reminder

GET    /api/notifications/                   # Last 50 notifications
GET    /api/notifications/unread-count       # Unread count
POST   /api/notifications/mark-read          # Mark all as read
POST   /api/notifications/:id/read           # Mark one as read
DELETE /api/notifications/                   # Clear all (current user)

GET    /api/admin/shift-configs              # List shift configs (admin)
PATCH  /api/admin/shift-configs/:id          # Update shift config (admin)
GET    /api/admin/telegram-chats             # List configured chats (admin)
POST   /api/admin/telegram-chats             # Add chat (admin)
PATCH  /api/admin/telegram-chats/:id         # Update chat settings (admin)
DELETE /api/admin/telegram-chats/:id         # Remove chat (admin)
POST   /api/admin/test-telegram-shift        # Manually fire shift telegram (admin)
GET    /api/admin/telegram-shift-preview     # Preview today's roster (admin)
GET    /api/admin/telegram-diagnostics       # Bot connectivity check (admin)
GET    /api/admin/audit-logs                 # Last 200 audit log entries (admin)
GET    /api/admin/telegram-templates         # List templates (admin)
POST   /api/admin/telegram-templates         # Create template (admin)
PATCH  /api/admin/telegram-templates/:id     # Update template (admin)
DELETE /api/admin/telegram-templates/:id     # Delete template (admin)

GET    /api/mail-reporter/mailboxes          # List mailboxes (admin)
POST   /api/mail-reporter/mailboxes          # Add mailbox (admin)
PATCH  /api/mail-reporter/mailboxes/:id      # Update mailbox (admin)
DELETE /api/mail-reporter/mailboxes/:id      # Remove mailbox (admin)
POST   /api/mail-reporter/mailboxes/:id/test # Test IMAP connection (admin)
GET    /api/mail-reporter/emails             # Email log list (no body)
GET    /api/mail-reporter/emails/:id         # Email detail (with body)
PATCH  /api/mail-reporter/emails/:id         # Mark solved / set status (all users)
DELETE /api/mail-reporter/emails             # Clear email logs (admin)
POST   /api/mail-reporter/poll-now           # Trigger immediate mail check (admin)
GET    /api/mail-reporter/rules              # List routing rules (admin)
POST   /api/mail-reporter/rules              # Create custom rule (admin)
PATCH  /api/mail-reporter/rules/:id          # Update rule (admin)
DELETE /api/mail-reporter/rules/:id          # Delete custom rule (admin)
GET    /api/mail-reporter/emails/:id/comments # List comments
POST   /api/mail-reporter/emails/:id/comments # Add comment

GET    /api/health                           # Health check — includes DB connectivity
GET    /api/config                           # Public config (Telegram bot username, portal timezone)
```

## Database Schema

PostgreSQL in Docker (named volume `postgres_data`). Schema managed by Alembic — `alembic upgrade head` runs on every `docker compose up` before the API starts.

**Tables:**

| Table | Description |
|-------|-------------|
| `users` | Accounts — role, password hash, OTP secret, Telegram fields, schedule rules, availability pattern |
| `groups` | Team groupings with name and colour |
| `user_groups` | Many-to-many user ↔ group association |
| `shift_configs` | Per-type config (DAY / NIGHT / OFFICE) — label, times, colour, emoji, requires_location |
| `shifts` | Individual shift assignments — user, date, type, times, published flag |
| `time_off_requests` | Vacation / sick leave requests with approval status and admin comment |
| `reminders` | User reminders — one-off or recurring, in-app + Telegram notification flags |
| `notifications` | In-app notification feed per user |
| `activity_logs` | Audit trail — action + details; username denormalised so entries survive user deletion |
| `telegram_chats` | Configured group chats/channels with per-notification-type enable flags |
| `telegram_templates` | Named presets for Telegram destinations (chat + optional topic) — referenced by mail rules and reminders |
| `shift_notification_logs` | Deduplication log — one row per (date, shift_type) prevents duplicate shift notifications |
| `mailbox_configs` | IMAP mailbox credentials (password encrypted at rest), poll settings, Telegram target, last-poll status |
| `mail_routing_rules` | Categorisation rules (built-in + user-defined) — match conditions, display config, Telegram target override; `mailbox_id = NULL` means global |
| `email_logs` | Processed email history — category, status (unchecked/solved/on_pause/blocked), Telegram delivery, extracted codes, body (capped at 64 KB) |
| `email_comments` | Per-email thread of comments from team members |

## Security

- Passwords hashed with bcrypt (passlib)
- JWT tokens signed with HS256: 30-minute access + 7-day refresh; token `type` claim validated on use
- TOTP 2FA (RFC 6238, pyotp) with ±1 step clock-drift window
- RBAC: `admin` and `engineer` roles; API enforces via `require_admin` dependency, frontend hides admin UI
- IMAP passwords encrypted at rest with Fernet (AES-128-CBC, key derived from `SECRET_KEY`)
- `SECRET_KEY` and `JWT_SECRET` validated at startup — refuses to start with defaults or values < 32 characters
- Rate limiting on login and token refresh (20 requests/min per IP, rolling window)
- Security response headers on every response: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`
- Request body size capped at 1 MB
- CORS restricted to configured origins; warns if `localhost` appears in production mode
- SQL injection prevention via SQLAlchemy ORM with parameterised queries
- Input validation via Pydantic v2 schemas
- All UUID primary keys stored and queried as native `uuid.UUID` objects (not strings) to match SQLAlchemy `Uuid(as_uuid=True)` bind processor

## Tech Stack

| Layer      | Technology                                              | Version   |
|------------|---------------------------------------------------------|-----------|
| Frontend   | React, Vite, CSS-in-JS (no UI library)                 | 18 / 5    |
| Backend    | FastAPI, Python                                         | 0.115 / 3.12 |
| Database   | PostgreSQL 16 (Docker)                                | asyncpg 0.29 |
| ORM        | SQLAlchemy async                                        | 2.0.35    |
| Auth       | python-jose (JWT HS256), passlib/bcrypt, pyotp (TOTP)  | —         |
| Workers    | APScheduler asyncio (reminders every 30s, shift crons) | 3.10.4    |
| Telegram   | httpx direct Bot API calls                              | 0.27.2    |
| Validation | Pydantic v2 + pydantic-settings                         | 2.9.2     |
| Container  | Docker Compose — 3 services: `db` + `api` + `frontend` | —         |

## Configuration

| Variable                | Required | Default                              | Description                                    |
|-------------------------|----------|--------------------------------------|------------------------------------------------|
| `SECRET_KEY`            | **yes**  | *(none)*                             | App secret; also derives Fernet encryption key. Generate: `openssl rand -hex 32` |
| `JWT_SECRET`            | **yes**  | *(none)*                             | JWT signing key. Generate: `openssl rand -hex 64` |
| `POSTGRES_PASSWORD`     | **yes**  | *(none)*                             | PostgreSQL password (used by Docker Compose). Generate: `openssl rand -hex 32` |
| `DATABASE_URL`          | no       | `postgresql+asyncpg://portal:<pw>@db:5432/portal` (Docker) | SQLAlchemy async URL                           |
| `PORTAL_TIMEZONE`       | no       | `UTC`                                | IANA timezone for shift times and crons        |
| `CORS_ORIGINS`          | no       | `http://localhost:5173,...`          | Comma-separated allowed origins                |
| `ENVIRONMENT`           | no       | `development`                        | Set to `production` to enable CORS origin warnings |
| `TELEGRAM_BOT_TOKEN`    | no       | *(empty)*                            | @BotFather token; leave empty to disable       |
| `TELEGRAM_BOT_USERNAME` | no       | *(empty)*                            | Bot username shown in the UI link flow         |
| `LOG_LEVEL`             | no       | `INFO`                               | Python log level (`DEBUG`, `INFO`, `WARNING`)  |
| `LOG_DIR`               | no       | *(empty — stderr only)*              | Directory for rotating log files (10 MB × 5 backups) |
| `MAIL_IMAP_SERVER`      | no       | `imap.yandex.com`                    | IMAP server hostname                           |
| `MAIL_IMAP_PORT`        | no       | `993`                                | IMAP SSL port                                  |
| `MAIL_IMAP_TIMEOUT`     | no       | `30`                                 | IMAP connection timeout (seconds)              |
| `MAIL_POLL_INTERVAL`    | no       | `30`                                 | Seconds between mailbox polls                  |
| `MAIL_DEFAULT_CHAT_ID`  | no       | *(empty)*                            | Fallback Telegram chat_id if mailbox has no target |
| `MAIL_DEFAULT_THREAD_ID`| no       | *(empty)*                            | Fallback Telegram thread/topic id              |

In Docker Compose `DATABASE_URL` is set to `postgresql+asyncpg://portal:<pw>@db:5432/portal`. For local development outside Docker, set `postgresql+asyncpg://portal:<password>@localhost:5432/portal` instead.

## Backend Structure

```
backend/
├── alembic.ini                     # Alembic config — used by `alembic upgrade head`
├── alembic/
│   ├── env.py                      # Async Alembic environment (reads DATABASE_URL from Settings)
│   └── versions/                   # Migration files — one per schema change
├── app/
│   ├── main.py                     # FastAPI app, lifespan (DB init + seed + migrations + scheduler)
│   ├── core/
│   │   ├── config.py               # Settings via pydantic-settings; startup secret validation
│   │   ├── database.py             # Async SQLAlchemy engine (PostgreSQL/asyncpg); get_db() dependency
│   │   ├── deps.py                 # get_current_user, require_admin, get_or_404 dependencies
│   │   ├── security.py             # hash_password, verify_password, create/decode JWT tokens
│   │   ├── scheduler.py            # Shared AsyncIOScheduler instance
│   │   ├── encryption.py           # Fernet encrypt/decrypt for sensitive fields (IMAP passwords)
│   │   └── logging_config.py       # Structured log format + optional rotating file handler
│   ├── models/models.py            # All SQLAlchemy ORM models (18 tables)
│   ├── schemas/schemas.py          # All Pydantic v2 request/response schemas (BaseOrmModel base)
│   ├── api/
│   │   ├── auth.py                 # Login, OTP setup/confirm/disable, token refresh (rate-limited)
│   │   ├── users.py                # User CRUD (admin) + self-service profile/telegram endpoints
│   │   ├── groups.py               # Group CRUD + member management (admin)
│   │   ├── schedule.py             # Shifts, auto-generation, publish, time-off requests
│   │   ├── reminders.py            # Reminder CRUD for current user
│   │   ├── notifications.py        # In-app notification feed
│   │   ├── admin_config.py         # Shift configs, Telegram chats/templates, audit logs
│   │   └── mail_reporter.py        # Mailbox CRUD, email log, routing rules, manual poll trigger
│   ├── services/
│   │   ├── schedule_service.py     # Greedy auto-generation algorithm with constraint satisfaction
│   │   ├── telegram_service.py     # Shift start + office roster Telegram notifications
│   │   ├── mail_reporter_service.py # IMAP polling, email classification, Telegram delivery
│   │   └── audit.py                # log_action() helper for activity_logs table
│   ├── workers/
│   │   ├── reminder_worker.py      # Fires due reminders every 30s; advances recurring reminders
│   │   ├── shift_notification_worker.py # 60s safety-net: fires shift notifications based on UTC clock
│   │   └── shift_notification_scheduler.py # On startup/publish: registers precise APScheduler 'date' jobs
│   └── tests/
│       ├── conftest.py             # pytest fixtures: PostgreSQL engine, async httpx client
│       ├── test_health.py          # /api/health smoke + DB check
│       ├── test_config.py          # Secret validation tests
│       ├── test_encryption.py      # Fernet roundtrip tests
│       ├── test_auth_rate_limit.py # Rate limiter boundary tests
│       ├── test_security_headers.py # Security headers presence
│       ├── test_body_limit.py      # 1 MB body rejection
│       ├── test_schedule_auth.py   # Enum role check static analysis
│       ├── test_schema_consistency.py # BaseOrmModel + get_or_404 structural tests
│       └── test_model_consistency.py # ORM model structural tests
```

## Frontend Structure

```
frontend/src/
├── main.jsx                  # React root, ThemeProvider, LangProvider
├── App.jsx                   # Sidebar nav, top bar (multi-TZ clocks, theme/lang), routing, notification polling
├── api.js                    # api(path, opts) — JWT from localStorage, auto-refresh on 401
├── theme.js                  # Design tokens (light/dark) + getGlobalCSS()
├── components/
│   ├── UI.jsx                # Shared primitives: Button, Input, Card, Badge, Avatar, Bar, Sparkline, Tag, StatusDot, Kbd, SLAGauge, Overlay, etc.
│   ├── Icons.jsx             # Inline SVG icon set (no emoji in JSX)
│   ├── EmailDetailModal.jsx  # Reusable email viewer (used by Home and Mail pages); includes MessageBody (collapsible)
│   ├── ThemeContext.jsx      # ThemeProvider + useTheme() hook (persists to localStorage)
│   ├── LangContext.jsx       # Language/i18n context (EN/RU)
│   └── NotificationsPanel.jsx # Bell dropdown with unread count and per-item mark-read
└── pages/
    ├── HomePage.jsx          # Engineer dashboard: greeting, metrics, mail queue (clickable rows), shift context
    ├── LoginPage.jsx         # Login form + OTP step
    ├── SchedulePage.jsx      # Weekly/monthly calendar, shift assignment, time-off
    ├── TimeOffPage.jsx       # Time-off request submission and status tracking
    ├── MailReporterPage.jsx  # IMAP email log (list + detail with collapsible body), mailbox config, routing rules (admin)
    ├── RemindersPage.jsx     # Reminder CRUD (create/edit/cancel; recurring; Telegram targets)
    ├── AdminPage.jsx         # Users, Groups, Shift config, Telegram, Telegram Templates, Audit Logs tabs
    └── ProfilePage.jsx       # Self-service profile, timezone, 2FA, Telegram link/unlink
```

**Navigation (sidebar):** Home · My Profile · Schedule · Mail · Time Off · Reminders · Admin *(admin only)*

**Routing:** No React Router. `page` state in `App.jsx` synced with `window.location.hash` (with a path-segment fallback for direct URL loads). All admin route gating is enforced in both the `useState` initializer and the `navigate()` function — both must be updated when adding new admin pages.
current page.
