# Support Team Internal Portal

A lightweight internal operations portal for first-line support teams.

## Architecture

```
┌─────────────────────────────────────┐
│  React + TypeScript (SPA)           │
│  DM Sans · Tailwind-like tokens     │
└──────────────┬──────────────────────┘
               │ REST API (JSON)
┌──────────────▼──────────────────────┐
│  FastAPI (Python 3.12)              │
│  JWT Auth · RBAC · APScheduler      │
├─────────────────────────────────────┤
│  Modules:                           │
│  · Auth (login + OTP)               │
│  · Schedule (shifts + auto-gen)     │
│  · Reminders (timers + recurring)   │
│  · Notifications (in-app + TG)      │
│  · Users (admin CRUD)               │
└──────┬────────────┬─────────────────┘
       │            │
┌──────▼──┐  ┌─────▼──────┐  ┌────────────┐
│ Postgres │  │   Redis    │  │ Telegram   │
│   16     │  │   7        │  │ Bot API    │
└──────────┘  └────────────┘  └────────────┘
```

## Quick Start

### 1. Clone and configure

```bash
cp .env.example .env
# Edit .env — set SECRET_KEY, JWT_SECRET, TELEGRAM_BOT_TOKEN
```

Generate secrets:
```bash
openssl rand -hex 32  # for SECRET_KEY
openssl rand -hex 64  # for JWT_SECRET
```

### 2. Start with Docker Compose

```bash
docker-compose up -d
```

This starts PostgreSQL, Redis, the API server (port 8000), and the frontend (port 5173).

### 3. Or run locally

**Backend:**
```bash
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
npm install && npm run dev
```

### 4. Default accounts

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

### Auth (login + OTP)
- Username/password login with bcrypt hashing
- Optional TOTP two-factor auth (Google Authenticator, Authy)
- JWT access + refresh tokens
- Rate limiting on login attempts

### Schedule
- Weekly calendar view with morning/afternoon/night shifts
- **Auto-generation**: one-click schedule creation respecting per-user rules
  - Minimum gap between shifts (configurable per person)
  - Maximum shifts per week (configurable per person)
  - Respects approved time-off
  - Greedy balancing for even workload
- Time-off requests with approval workflow
- Draft → Published workflow for admin review

### Reminders
- Create reminders with specific date/time
- Quick-set buttons (15min, 30min, 1hr, 2hr, tomorrow 9am)
- Recurring reminders (every N minutes)
- Dual notification: in-app + Telegram
- Background worker checks every 30 seconds

### Telegram Bot
- Link portal accounts to Telegram via verification code
- Commands: `/link`, `/myshift`, `/reminders`
- Receives reminder notifications automatically
- Setup: create bot via @BotFather, set token in .env

### Notifications
- In-app notification center with unread count
- Real-time polling (15s interval)
- Mark individual or all as read

## API Endpoints

```
POST   /api/auth/login          # Step 1: credentials
POST   /api/auth/verify-otp     # Step 2: OTP (if enabled)
POST   /api/auth/setup-otp      # Generate QR code
POST   /api/auth/confirm-otp    # Enable OTP
POST   /api/auth/refresh        # Refresh tokens
GET    /api/auth/me              # Current user

GET    /api/users/               # List users
POST   /api/users/               # Create user (admin)
PATCH  /api/users/:id            # Update user (admin)
POST   /api/users/:id/telegram-link-code

GET    /api/schedule/shifts      # ?start_date=&end_date=
POST   /api/schedule/shifts      # Create shift (admin)
DELETE /api/schedule/shifts/:id  # Delete shift (admin)
POST   /api/schedule/generate    # Auto-generate (admin)
POST   /api/schedule/publish     # Publish drafts (admin)
GET    /api/schedule/time-off    # List requests
POST   /api/schedule/time-off    # Submit request
PATCH  /api/schedule/time-off/:id # Approve/reject (admin)

GET    /api/reminders/           # All reminders
GET    /api/reminders/active     # Active only
POST   /api/reminders/           # Create
PATCH  /api/reminders/:id        # Update
DELETE /api/reminders/:id        # Cancel

GET    /api/notifications/       # List (last 50)
GET    /api/notifications/unread-count
POST   /api/notifications/mark-read
POST   /api/notifications/:id/read

GET    /api/health               # Health check
```

## Security

- Passwords hashed with bcrypt
- JWT tokens with short-lived access (30min) + long-lived refresh (7 days)
- OTP via TOTP (RFC 6238) with configurable time window
- Role-based access control (admin vs engineer)
- CORS restricted to configured origins
- SQL injection prevention via SQLAlchemy ORM
- Input validation via Pydantic schemas

## Tech Stack

| Layer      | Technology                          |
|------------|-------------------------------------|
| Frontend   | React 18, DM Sans, CSS-in-JS       |
| Backend    | FastAPI, Python 3.12                |
| Database   | PostgreSQL 16                       |
| Cache      | Redis 7                             |
| Auth       | JWT (python-jose), bcrypt, pyotp    |
| Workers    | APScheduler (in-process)            |
| Telegram   | python-telegram-bot, httpx          |
| Container  | Docker Compose                      |
