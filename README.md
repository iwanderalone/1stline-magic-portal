# 1stline Magic Portal

Internal operations portal for first-line support teams: shift scheduling and time-off, IMAP mail monitoring with Telegram forwarding and SMTP replies, a read-only Zammad ticket mirror, Prometheus-fed service status board, runbooks, an AI assistant (Gemini), NetBox inventory and handover documents, notifications and an admin panel.

## Stack

- **Backend:** FastAPI (Python 3.12), SQLAlchemy async + PostgreSQL, Alembic, APScheduler (in-process workers)
- **Frontend:** React 18 + Vite 5 (single-page app, hash routing, EN/RU)
- **Auth:** local accounts with optional TOTP 2FA, optional Keycloak OIDC SSO, roles `admin` / `manager` / `engineer` / `hr`
- **Integrations (all optional):** Telegram bot, IMAP/SMTP, Zammad, Grafana webhooks, Prometheus `remote_write`, NetBox, S3-compatible storage, Google Gemini

## Quick start (Docker)

```bash
cp .env.example .env        # then fill in the required values below
mkdir -p data
docker compose up -d --build
```

Required in `.env`:

```bash
SECRET_KEY=            # openssl rand -hex 32
JWT_SECRET=            # openssl rand -hex 64
POSTGRES_PASSWORD=     # openssl rand -hex 32
```

The frontend is served on port 80 (nginx, proxies `/api`), the API on 8000 (`/docs` for the OpenAPI UI). Database migrations run automatically on start, and a first-run seed creates demo accounts (see `seed_defaults` in `backend/app/main.py`) — **change those passwords immediately**.

All other settings are documented in `.env.example`. Most operational values can also be changed at runtime from **Admin → Settings** without a redeploy.

## Local development

```bash
# backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# frontend (dev server on :5173, proxies /api to :8000)
cd frontend
npm install
npm run dev
```

Tests: `cd backend && pytest` (needs a PostgreSQL instance, see `backend/tests/conftest.py`).

## Repository layout

```
backend/app/
  api/        FastAPI routers, one per domain
  core/       config, database, auth/security, scheduler, encryption, runtime settings
  models/     SQLAlchemy models
  schemas/    Pydantic schemas
  services/   business logic and integrations
  workers/    background jobs
backend/alembic/   database migrations
backend/tests/     pytest suite
frontend/src/      pages, shared components, i18n, theme
examples/          document templates used by the app
```

## Branches

Development happens on `dev`; `main` holds tested, stable code.
