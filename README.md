# 1line-portal — Support Team Internal Portal

A lightweight internal operations portal for first-line support teams. Provides shift scheduling, reminders, Telegram bot integration, and an in-app notification centre.

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
│  · Auth         (login + TOTP 2FA)            │
│  · Users        (admin CRUD + profile)        │
│  · Groups       (team groupings)              │
│  · Schedule     (shifts + auto-generation)    │
│  · Reminders    (one-off + recurring)         │
│  · Notifications (in-app + Telegram)          │
│  · Admin config  (shift types, Telegram chats)│
└───────────────────┬──────────────────────────┘
                    │
          ┌─────────▼──────────┐   ┌──────────────┐
          │  SQLite (aiosqlite) │   │ Telegram      │
          │  WAL mode           │   │ Bot API       │
          │  data/portal.db     │   │ (optional)    │
          └────────────────────┘   └──────────────┘
```

**No PostgreSQL. No Redis.** SQLite with WAL mode handles concurrent reads/writes from both the HTTP server and the APScheduler background worker without locking issues.

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
```

For a VPS deployment also set `CORS_ORIGINS` in `.env`:

```
CORS_ORIGINS=http://YOUR_SERVER_IP,https://portal.example.com
```

### 2. Create the data directory

```bash
mkdir -p data
```

The SQLite database lands at `./data/portal.db` (mounted into the container as `/app/data/portal.db`).

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
- Time-off requests (day off / vacation / sick leave) with admin approve/reject workflow

### Reminders
- Create one-off or recurring reminders
- Quick-set buttons: 15 min, 30 min, 1 h, 2 h, tomorrow 09:00
- Dual notifications: in-app bell + Telegram DM
- Background worker fires due reminders every 30 seconds

### Telegram Bot
- Link portal accounts via short verification code (`/link <CODE>`)
- Bot commands: `/link <code>`, `/myshift`
- Shift start notifications sent to linked personal chats
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
- **Notifications tab**: send test in-app (and optionally Telegram) notifications to selected users
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

GET    /api/users/                           # List all users (any role)
POST   /api/users/                           # Create user (admin)
GET    /api/users/me/profile                 # Current user profile
PATCH  /api/users/me/profile                 # Update own profile
POST   /api/users/me/telegram-link-code      # Generate own Telegram link code
PATCH  /api/users/:id                        # Update user (admin)
DELETE /api/users/:id                        # Deactivate user (admin)
POST   /api/users/:id/reset-password         # Reset password (admin)
POST   /api/users/:id/telegram-link-code     # Generate link code for user (admin)
POST   /api/users/:id/reset-otp              # Disable 2FA for user (admin)

GET    /api/groups/                          # List groups
POST   /api/groups/                          # Create group (admin)
PATCH  /api/groups/:id                       # Update group (admin)
PUT    /api/groups/:id/members               # Set group members (admin)
DELETE /api/groups/:id                       # Delete group (admin)

GET    /api/schedule/shift-configs           # Active shift type configs
GET    /api/schedule/shifts                  # ?start_date=&end_date=
POST   /api/schedule/shifts                  # Create shift (admin)
DELETE /api/schedule/shifts/:id              # Delete shift (admin)
POST   /api/schedule/generate                # Auto-generate schedule (admin)
POST   /api/schedule/publish                 # Publish draft shifts (admin)
GET    /api/schedule/time-off                # List time-off requests
POST   /api/schedule/time-off                # Submit time-off request
PATCH  /api/schedule/time-off/:id            # Approve/reject request (admin)

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
DELETE /api/notifications/admin/:user_id     # Clear for user (admin)

GET    /api/admin/shift-configs              # List shift configs (admin)
POST   /api/admin/shift-configs              # Create shift config (admin)
PATCH  /api/admin/shift-configs/:id          # Update shift config (admin)
GET    /api/admin/telegram-chats             # List configured chats (admin)
POST   /api/admin/telegram-chats             # Add chat (admin)
PATCH  /api/admin/telegram-chats/:id         # Update chat settings (admin)
DELETE /api/admin/telegram-chats/:id         # Remove chat (admin)
POST   /api/admin/test-notification          # Send test notification (admin)
GET    /api/admin/audit-logs                 # Last 200 audit log entries (admin)

GET    /api/health                           # Health check
```

## Database Schema

SQLite at `data/portal.db`, persisted via Docker volume. Schema created automatically on first startup via `Base.metadata.create_all`. Additive column migrations applied via `run_migrations()` on every startup (safe to re-run).

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

## Security

- Passwords hashed with bcrypt (passlib)
- JWT tokens signed with HS256: 30-minute access + 7-day refresh; token `type` claim validated on use
- TOTP 2FA (RFC 6238, pyotp) with ±1 step clock-drift window
- RBAC: `admin` and `engineer` roles; API enforces via `require_admin` dependency, frontend hides admin UI
- CORS restricted to `localhost:5173` / `localhost:3000` (configurable)
- SQL injection prevention via SQLAlchemy ORM with parameterised queries
- Input validation via Pydantic v2 schemas
- All UUID primary keys stored and queried as native `uuid.UUID` objects (not strings) to match SQLAlchemy `Uuid(as_uuid=True)` bind processor

## Tech Stack

| Layer      | Technology                                              | Version   |
|------------|---------------------------------------------------------|-----------|
| Frontend   | React, Vite, CSS-in-JS (no UI library)                 | 18 / 5    |
| Backend    | FastAPI, Python                                         | 0.115 / 3.12 |
| Database   | SQLite via aiosqlite (WAL mode, zero external deps)     | 0.20.0    |
| ORM        | SQLAlchemy async                                        | 2.0.35    |
| Auth       | python-jose (JWT HS256), passlib/bcrypt, pyotp (TOTP)  | —         |
| Workers    | APScheduler asyncio (reminders every 30s, shift crons) | 3.10.4    |
| Telegram   | httpx direct Bot API calls                              | 0.27.2    |
| Validation | Pydantic v2 + pydantic-settings                         | 2.9.2     |
| Container  | Docker Compose — 2 services: `api` + `frontend`        | —         |

## Configuration

| Variable              | Required | Default                              | Description                    |
|-----------------------|----------|--------------------------------------|--------------------------------|
| `SECRET_KEY`          | yes      | insecure default                     | App secret key                 |
| `JWT_SECRET`          | yes      | insecure default                     | JWT signing key                |
| `DATABASE_URL`        | no       | `sqlite+aiosqlite:///./portal.db`    | SQLAlchemy async URL           |
| `TELEGRAM_BOT_TOKEN`  | no       | *(empty)*                            | @BotFather token               |
| `DEBUG`               | no       | `false`                              | SQLAlchemy echo logging        |

In Docker Compose the database URL is overridden to `sqlite+aiosqlite:////app/data/portal.db` so the file lands in the persisted `./data` volume mount.

## Backend Structure

```
backend/app/
├── main.py                   # FastAPI app, lifespan (DB init + seed + migrations), APScheduler jobs
├── core/
│   ├── config.py             # Settings via pydantic-settings; get_settings() (lru_cache)
│   ├── database.py           # Async SQLAlchemy engine; WAL mode pragmas; get_db() dependency
│   ├── deps.py               # get_current_user, require_admin FastAPI dependencies
│   └── security.py           # hash_password, verify_password, create/decode JWT tokens
├── models/models.py          # All SQLAlchemy ORM models
├── schemas/schemas.py        # All Pydantic v2 request/response schemas
├── api/
│   ├── auth.py               # Login, OTP setup/confirm/disable, token refresh
│   ├── users.py              # User CRUD (admin) + self-service profile/telegram endpoints
│   ├── groups.py             # Group CRUD + member management (admin)
│   ├── schedule.py           # Shifts, auto-generation, publish, time-off requests
│   ├── reminders.py          # Reminder CRUD for current user
│   ├── notifications.py      # In-app notification feed
│   └── admin_config.py       # Shift configs, Telegram chats, test notifications, audit logs
├── services/
│   ├── schedule_service.py   # Greedy auto-generation algorithm with constraint satisfaction
│   ├── telegram_service.py   # Shift start + office roster Telegram notifications
│   └── audit.py              # log_action() helper for activity_logs table
└── workers/
    └── reminder_worker.py    # Fires due reminders every 30s; advances recurring reminders
```

## Frontend Structure

```
frontend/src/
├── main.jsx                  # React root, ThemeProvider
├── App.jsx                   # Sidebar nav, notification bell polling (15s), page routing
├── api.js                    # api(path, opts) — JWT from sessionStorage, auto-refresh on 401
├── theme.js                  # Design tokens (light/dark) + getGlobalCSS()
├── components/
│   ├── UI.jsx                # Shared primitives: Button, Input, Card, Badge, Modal, etc.
│   ├── ThemeContext.jsx       # ThemeProvider + useTheme() hook (persists to localStorage)
│   ├── LangContext.jsx        # Language/i18n context
│   └── NotificationsPanel.jsx # Bell dropdown with unread count
└── pages/
    ├── LoginPage.jsx          # Login form + OTP step
    ├── SchedulePage.jsx       # Weekly/monthly calendar, time-off requests
    ├── RemindersPage.jsx      # Reminder list + create/edit
    ├── AdminPage.jsx          # Users, Groups, Shift config, Telegram, Notifications, Logs tabs
    └── ProfilePage.jsx        # Self-service profile, timezone, 2FA, Telegram settings
```
