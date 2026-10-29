# 1stline Magic Portal

Internal operations portal for a first-line IT support team.

## Modules

- **Home** — what needs attention now: services down, stale tickets, unhandled mail, who is on shift
- **Schedule & Time off** — shift calendar with auto-generation, time-off requests and approval, Telegram shift reminders
- **Mail** — IMAP mailbox monitoring, routing rules, forwarding to Telegram, replies from the portal over SMTP
- **Tickets** — read-only Zammad mirror with portal-only notes and Telegram escalation of overdue tickets
- **Service Status** — live probe board fed by Prometheus `remote_write`
- **Runbooks** — step-by-step playbook library
- **AI assistant** — chat over schedule, time off, runbooks, mail and inventory; reads supplier invoices. Runs on Gemini or a self-hosted model (any OpenAI-compatible API)
- **Tools** — NetBox inventory, device handover documents, mailbox backup to S3
- **Finances** — subscriptions, seats, payments, budgets, renewal reminders; add equipment by invoice (invoice → NetBox devices → payment → handover)
- **Admin** — users, groups, roles, Telegram destinations, audit log, live settings (no redeploy)

## Stack

- **Backend:** Python 3.12, FastAPI, SQLAlchemy (async) + PostgreSQL, Alembic, APScheduler
- **Frontend:** React 18 + Vite, EN/RU
- **Auth:** local accounts with optional TOTP, optional Keycloak SSO
- **Integrations (all optional):** Telegram, IMAP/SMTP, Zammad, Prometheus, Grafana, NetBox, S3, Gemini / OpenAI-compatible LLM

## Run

```bash
cp .env.example .env    # set SECRET_KEY, JWT_SECRET, POSTGRES_PASSWORD
mkdir -p data
docker network create proxy  # once; the reverse proxy reaches the frontend over it
docker compose up -d --build
```

Frontend on `127.0.0.1:3000`, API on `127.0.0.1:8000` (`/docs`) — put a reverse proxy in front. Migrations run on start; the first run creates demo accounts — change their passwords. Everything optional is in `.env.example` and most of it can be changed later in **Admin → Settings**.

### Local development

```bash
cd backend && python -m venv venv && source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

cd frontend && npm install && npm run dev    # :5173, proxies /api to :8000
```

Tests: `cd backend && pytest` (needs PostgreSQL).
