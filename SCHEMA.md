# Technical Reference — 1line Portal

Architecture, stack, modules, and data model.

---

## Stack

| Layer | Technology | Version | Notes |
|-------|-----------|---------|-------|
| Frontend | React + Vite | 18 / 5 | No router library — page state via `useState` + URL hash |
| Styling | CSS-in-JS (no library) | — | Design tokens in `theme.js`, injected as `<style>` tag |
| Backend | FastAPI + Python | 0.115 / 3.12 | Async throughout |
| Database | SQLite via aiosqlite | 0.20.0 | WAL mode; no PostgreSQL, no Redis |
| ORM | SQLAlchemy async | 2.0.35 | `AsyncSession` + `AsyncEngine` |
| Auth | python-jose (JWT HS256) + passlib/bcrypt + pyotp (TOTP) | — | |
| Background jobs | APScheduler asyncio | 3.10.4 | In-process; no Celery, no Redis |
| Telegram | httpx (direct Bot API calls) | 0.27.2 | Long-polling via `getUpdates` |
| Validation | Pydantic v2 + pydantic-settings | 2.9.2 | |
| Container | Docker Compose — 2 services | — | `api` + `frontend` (nginx) |

---

## Deployment topology

```
Browser
  │ HTTPS
  ▼
Server nginx (port 443)          ← TLS termination, Let's Encrypt
  ├── /api/*  → 127.0.0.1:8000   ← FastAPI (Docker, bound to localhost)
  └── /*      → 127.0.0.1:3000   ← nginx serving React bundle (Docker, bound to localhost)

Docker containers (both bound to 127.0.0.1 only, not reachable externally):
  api       :8000  — uvicorn, 1 worker (SQLite WAL safe)
  frontend  :3000  — nginx alpine serving /usr/share/nginx/html
```

Data persistence:
```
./data/portal.db          ← SQLite database (host path, mounted into api container)
```

---

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `SECRET_KEY` | yes | insecure default | App secret; generate with `openssl rand -hex 32` |
| `JWT_SECRET` | yes | insecure default | JWT signing key; generate with `openssl rand -hex 64` |
| `DATABASE_URL` | no | `sqlite+aiosqlite:///./portal.db` | SQLAlchemy async URL |
| `PORTAL_TIMEZONE` | no | `UTC` | IANA timezone for shift times and scheduler crons |
| `CORS_ORIGINS` | no | `http://localhost:5173,...` | Comma-separated allowed origins |
| `TELEGRAM_BOT_TOKEN` | no | *(empty)* | @BotFather token; leave empty to disable Telegram |
| `TELEGRAM_BOT_USERNAME` | no | *(empty)* | Bot username shown in the UI link flow |

---

## Backend modules

### `app/main.py`
FastAPI app entry point.

- **Lifespan**: creates DB schema (`Base.metadata.create_all`), runs additive column migrations (`run_migrations`), seeds default users + shift configs (`seed_defaults`).
- **Scheduler** (`AsyncIOScheduler`, timezone = `PORTAL_TIMEZONE`):
  - Every 30s: `check_and_fire_reminders`
  - 07:45: `notify_shift_start(DAY)`
  - 19:45: `notify_shift_start(NIGHT)`
  - 08:50: `notify_office_roster`
  - Every 3s (if token set): `poll_telegram_updates`
- **Routes**: `/api/health`, `/api/config` (public, no auth).

### `app/core/config.py`
`Settings` via pydantic-settings. `get_settings()` is `lru_cache`-ed — one instance per process. `CORS_ORIGINS` is stored as a comma-separated string and split via a `@property`.

### `app/core/database.py`
- `AsyncEngine` + `AsyncSessionFactory`
- SQLite WAL mode pragmas applied via `@event.listens_for(engine.sync_engine, "connect")`
- `get_db()` FastAPI dependency yields a session scoped to the request

### `app/core/deps.py`
- `get_current_user` — decodes JWT, fetches user from DB, raises 401 if invalid/inactive
- `require_admin` — calls `get_current_user`, raises 403 if role ≠ admin

### `app/core/security.py`
`hash_password`, `verify_password` (bcrypt), `create_access_token`, `create_refresh_token`, `decode_token`.

### `app/api/auth.py`
| Endpoint | Description |
|----------|-------------|
| `POST /api/auth/login` | Returns `access_token` + `refresh_token`, or `temp_token` if OTP required |
| `POST /api/auth/verify-otp` | Exchanges `temp_token` + OTP code for full tokens |
| `POST /api/auth/setup-otp` | Generates TOTP secret + QR SVG |
| `POST /api/auth/confirm-otp` | Enables OTP after first successful code entry |
| `POST /api/auth/disable-otp` | Disables OTP with current code |
| `POST /api/auth/refresh` | Exchanges refresh token for new token pair |
| `GET /api/auth/me` | Returns current user |

### `app/api/users.py`
Self-service and admin user management. Key points:
- Static paths (`/me/profile`, `/me/telegram-link-code`) registered **before** parameterised `/{user_id}` routes to prevent FastAPI swallowing `/me` as a UUID.
- `user_to_response` deserialises JSON-encoded `availability_pattern` and `allowed_shift_types` columns.

### `app/api/schedule.py`
Shift CRUD, auto-generation, publish, time-off requests. Auto-generation calls `schedule_service.generate_schedule()`.

### `app/api/reminders.py`
Reminder CRUD scoped to the current user. Only returns the user's own reminders.

### `app/api/notifications.py`
In-app notification feed. `GET /unread-count` is polled by the frontend every 15s.

### `app/api/admin_config.py`
Admin-only: shift config CRUD, Telegram chat CRUD, test notifications, audit logs.
`POST /api/admin/test-telegram-shift?shift_type=day|night|office` manually fires the real shift notification for today (useful for verifying the full Telegram pipeline end-to-end).

### `app/services/schedule_service.py`
Greedy schedule auto-generation:
1. Collects all active engineers + approved time-off per day.
2. Shuffles per-day to randomise tie-breaking.
3. For each shift slot (day/night/office per day), assigns engineers that satisfy:
   - Not on time-off that day
   - `min_shift_gap_days` gap since last shift
   - `max_shifts_per_week` not exceeded
   - `allowed_shift_types` allows this type
   - Availability pattern (if set) permits this day in the cycle
4. Returns a list of `Shift` objects (not persisted until caller commits).

### `app/services/telegram_service.py`
All Telegram I/O. Uses `httpx` (no `python-telegram-bot` dependency).

**Outbound:**
- `send_telegram_message(chat_id, text, topic_id=None)` — single message send, async, returns bool
- `notify_shift_start(shift_type)` — fires at day/night cron; sends group roster to configured chats + personal DM to each shift worker
- `notify_office_roster()` — fires at 08:50; sends office roster to configured chats + personal DMs to office workers

**Inbound (long-polling):**
- `poll_telegram_updates()` — called every 3s; fetches `getUpdates` with 3s timeout, dispatches commands
- `handle_link_command(chat_id, code)` — looks up `telegram_link_code`, sets `telegram_chat_id`, clears code
- `handle_myshift_command(chat_id)` — returns next 5 shifts for the linked user

**Timezone handling:**
- Shift times are stored as naive `time` values.
- They are interpreted as being in `PORTAL_TIMEZONE` (from config).
- Personal notification messages display times converted to each user's own `timezone` field.

### `app/workers/reminder_worker.py`
Runs every 30s. Finds reminders where `status=ACTIVE` and `remind_at <= now (UTC)`. For each:
1. Creates an in-app `Notification` if `notify_in_app=True`.
2. Sends a Telegram message if `notify_telegram=True`:
   - `target=personal` → user's `telegram_chat_id`
   - `target=groups` → all active `TelegramChat` rows with `notify_reminders=True`
   - `target=both` → both of the above
3. Advances `remind_at` by `recurrence_minutes` for recurring reminders, or marks as FIRED.

---

## Database schema

SQLite at `data/portal.db`. Schema created automatically via `Base.metadata.create_all`. Additive migrations applied via `run_migrations()` on every startup (safe to re-run; uses `ALTER TABLE ADD COLUMN` which SQLite ignores if the column already exists).

### `users`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | |
| `username` | string, unique | Login name |
| `display_name` | string | Shown in UI and notifications |
| `hashed_password` | string | bcrypt |
| `role` | enum | `admin` / `engineer` |
| `is_active` | bool | Soft-delete flag |
| `avatar_url` | string | Optional URL |
| `name_color` | string | Hex colour for shift cards |
| `otp_secret` | string | TOTP secret (base32) |
| `otp_enabled` | bool | |
| `telegram_chat_id` | string | Set after `/link` command |
| `telegram_username` | string | Display only, not used for sending |
| `telegram_link_code` | string | Temporary code, cleared after use |
| `telegram_notify_shifts` | bool | |
| `telegram_notify_reminders` | bool | |
| `timezone` | string | IANA, e.g. `Europe/Moscow` |
| `min_shift_gap_days` | int | Auto-gen constraint |
| `max_shifts_per_week` | int | Auto-gen constraint |
| `availability_pattern` | JSON string | Optional cycle pattern |
| `availability_anchor_date` | date | Cycle start date |
| `allowed_shift_types` | JSON string | `null` = all types allowed |

### `groups` / `user_groups`
Named groups with a colour. Many-to-many with `users` via `user_groups` association table.

### `shift_configs`
One row per shift type (DAY / NIGHT / OFFICE). Stores label, emoji, colour, default start/end time, duration, location requirement, active flag.

### `shifts`
| Column | Notes |
|--------|-------|
| `user_id` | FK → users |
| `date` | The calendar date of the shift |
| `shift_type` | DAY / NIGHT / OFFICE |
| `start_time`, `end_time` | Naive time, interpreted in `PORTAL_TIMEZONE` |
| `location` | `onsite` / `remote` / null |
| `is_published` | `false` = draft (admin-only); `true` = visible to all |

Unique constraint: `(user_id, date, shift_type)`.

### `time_off_requests`
`pending` → `approved` / `rejected` by admin. Approved requests block auto-generation for those dates.

### `reminders`
`remind_at` is UTC-aware. `status`: `active` → `fired` (or stays `active` for recurring). `telegram_target`: `none` / `personal` / `groups` / `both`.

### `notifications`
Per-user in-app notification feed. `is_read` flag. Cleared individually or all-at-once.

### `activity_logs`
Audit trail. `username` is denormalised (stored as string) so entries survive user deletion.

### `telegram_chats`
Configured group chats/channels. Per-type notification flags: `notify_day_shift_start`, `notify_night_shift_start`, `notify_office_roster`, `notify_reminders`, `notify_general`.

---

## Frontend structure

```
frontend/src/
├── main.jsx               # React root, ThemeProvider, LangProvider
├── App.jsx                # Sidebar nav, notification bell (15s poll), hash routing
├── api.js                 # api() wrapper: JWT from sessionStorage, auto-refresh on 401
├── theme.js               # Design tokens (light/dark) + getGlobalCSS()
├── components/
│   ├── UI.jsx             # Button, Input, Card, Badge, Modal, Toast, Tabs, etc.
│   ├── ThemeContext.jsx    # useTheme() — persists to localStorage
│   ├── LangContext.jsx     # useLang() — EN/RU translations
│   └── NotificationsPanel.jsx
└── pages/
    ├── LoginPage.jsx       # Login + optional OTP step
    ├── SchedulePage.jsx    # Weekly/monthly calendar, world clock, time-off
    ├── RemindersPage.jsx   # Reminder list + create/edit
    ├── AdminPage.jsx       # Users, Groups, Shift config, Telegram, Notifications, Logs
    └── ProfilePage.jsx     # Identity, timezone, Telegram linking, 2FA
```

**Routing:** No React Router. `page` state in `App.jsx` synced with `window.location.hash`. On refresh, hash is read to restore the current page.

**Auth flow:** Login → (optional OTP) → `{ access_token, refresh_token, user }` stored in `sessionStorage`. `api()` in `api.js` injects the Bearer token on every request. On 401, tokens are cleared and the page reloads to the login screen.

**Theme:** Light/dark toggled via `ThemeContext`. Design tokens (colours, spacing, font families) defined once in `theme.js` and passed as a `t` prop throughout.

---

## Telegram integration — full flow

```
User action                Backend                          Telegram API
─────────────────────────────────────────────────────────────────────
1. User clicks             POST /users/me/telegram-link-code
   "Get link code"         → generates 8-char hex code,
                             stores in user.telegram_link_code

2. User sends              poll_telegram_updates() (every 3s)
   "/link XXXXXXXX"        → handle_link_command()
   to bot                  → finds user by code
                           → sets user.telegram_chat_id = chat_id
                           → clears telegram_link_code
                           → replies "Linked to <name>"

3. Frontend auto-detects   GET /users/me/profile (every 3s while
   the link                linkCode is shown) → sees telegram_chat_id
                           → updates badge to "Linked"

4. Scheduled crons         notify_shift_start(DAY)  @ 07:45 PORTAL_TZ
   fire daily              notify_shift_start(NIGHT) @ 19:45 PORTAL_TZ
                           notify_office_roster()    @ 08:50 PORTAL_TZ
                           → for each today's published shift:
                             • send to group chats with matching flag
                             • send personal DM to worker if enabled

5. Reminders fire          check_and_fire_reminders() (every 30s)
                           → send_telegram_message() to user's
                             chat_id and/or group chats
```

---

## Adding a new page (frontend)

1. Create `frontend/src/pages/MyPage.jsx`.
2. Import it in `App.jsx`.
3. Add an entry to the `nav` array in `App.jsx`.
4. Add `{page === 'mypage' && <MyPage />}` to the render.

The hash routing picks it up automatically.

## Adding a new API route (backend)

1. Create `backend/app/api/mymodule.py` with an `APIRouter`.
2. Import and register in `main.py`: `app.include_router(mymodule.router, prefix="/api")`.
3. Add any new models to `models/models.py` and a migration string to `run_migrations()` if you're adding columns to existing tables.
