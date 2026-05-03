# Dev Environment Deployment — portal.dev.wanderalone.moe

Deploy the `feat/postgresql-migration` branch as a separate test instance on the same VPS
as production, with zero risk of touching production data.

## How it differs from production

| | Production | Dev |
|---|---|---|
| Branch | `main` | `feat/postgresql-migration` |
| API port | `127.0.0.1:8000` | `127.0.0.1:8001` |
| Frontend port | `127.0.0.1:3000` | `127.0.0.1:3001` |
| Docker project | `portal` (default) | `portal-dev` |
| PostgreSQL volume | `postgres_data` | `postgres_data_dev` |
| Database name | `portal` | `portal_dev` |
| Data directory | `./data` | `./data-dev` |
| Env file | `.env` | `.env.dev` |

---

## Step 1 — Pull the branch

```bash
git fetch origin
git checkout feat/postgresql-migration
git pull
```

---

## Step 2 — Create `.env.dev`

```bash
cp .env.dev.example .env.dev
```

Fill in the required values:

```bash
SECRET_KEY=$(openssl rand -hex 32)
JWT_SECRET=$(openssl rand -hex 64)
POSTGRES_PASSWORD=$(openssl rand -hex 32)
```

Edit `.env.dev` and paste the generated values. The Telegram token can be left empty or
shared with production — they run in completely separate containers.

Set `CORS_ORIGINS` to your dev subdomain:

```
CORS_ORIGINS=https://portal.dev.wanderalone.moe
```

---

## Step 3 — Start the dev stack

```bash
docker compose -p portal-dev -f docker-compose.dev.yml --env-file .env.dev up -d --build
```

Alembic runs automatically on startup and applies all migrations to `portal_dev`.
Check logs if anything looks wrong:

```bash
docker compose -p portal-dev -f docker-compose.dev.yml logs -f api
```

---

## Step 4 — Configure nginx

Create `/etc/nginx/sites-available/portal-dev`:

```nginx
server {
    listen 80;
    server_name portal.dev.wanderalone.moe;

    location /api {
        proxy_pass http://127.0.0.1:8001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

Enable it and get a TLS certificate:

```bash
ln -s /etc/nginx/sites-available/portal-dev /etc/nginx/sites-enabled/
nginx -t
systemctl reload nginx

certbot --nginx -d portal.dev.wanderalone.moe
```

---

## Step 5 — (Optional) seed with production data

If you want real data in the dev instance for testing, follow the steps in `migrate.md`
but target the dev database:

```bash
SQLITE_URL="sqlite+aiosqlite:////path/to/data/portal.db" \
POSTGRES_URL="postgresql+asyncpg://portal:<DEV_PASSWORD>@127.0.0.1:5433/portal_dev" \
SECRET_KEY="<dev-secret-key>" \
JWT_SECRET="<dev-jwt-secret>" \
python backend/scripts/migrate_sqlite_to_postgres.py
```

Note: the dev PostgreSQL is not exposed on the host by default. Either run the script
inside the container or temporarily expose the port in `docker-compose.dev.yml`.

---

## Day-to-day commands

```bash
# Rebuild after a code change
docker compose -p portal-dev -f docker-compose.dev.yml --env-file .env.dev up -d --build

# Follow logs
docker compose -p portal-dev -f docker-compose.dev.yml logs -f

# Stop (keeps volumes/data)
docker compose -p portal-dev -f docker-compose.dev.yml down

# Stop and wipe all dev data
docker compose -p portal-dev -f docker-compose.dev.yml down -v
```
