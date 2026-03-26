# 1line Portal — Telegraf Agent

Uses **Telegraf** (by InfluxData) to collect VPS metrics and push them to the portal.
A tiny Python companion script polls for and executes container commands (start/stop/restart).

## What it collects

| Source | Data | Interval |
|---|---|---|
| `inputs.cpu` | CPU usage % | 15s |
| `inputs.mem` | RAM used / total | 15s |
| `inputs.disk` | Disk used / total (root `/`) | 15s |
| `inputs.system` | Load avg, uptime | 15s |
| `inputs.docker` | Container status, CPU %, memory per container | 15s |
| `scripts/apt-updates.py` | Pending OS update list | 1h |
| `scripts/failed-services.sh` | Failed systemd units | 1m |
| `scripts/recent-logins.py` | Recent SSH logins | 5m |

---

## Step 1 — Register the agent in the portal

1. Log in as admin → **Containers** sidebar item → **+ Register Agent**
2. Enter a name (e.g. `vps-berlin-01`) and optional description
3. **Copy the API key** — it is shown only once
4. Note the Agent UUID shown in the agent list

---

## Step 2 — Deploy with Docker Compose (recommended)

### Create the environment file

```bash
sudo mkdir -p /etc/1line-agent
sudo tee /etc/1line-agent/.env > /dev/null <<EOF
PORTAL_URL=https://your-portal.example.com
AGENT_ID=<uuid-from-portal>
AGENT_KEY=<key-from-portal>
EOF
sudo chmod 600 /etc/1line-agent/.env
```

### Find your Docker GID (needed for socket access)

```bash
getent group docker | cut -d: -f3
# e.g. 999 — add to .env:
echo "DOCKER_GID=999" | sudo tee -a /etc/1line-agent/.env
```

### Copy agent files

```bash
git clone https://github.com/iwanderalone/1stline-magic-portal
cd 1stline-magic-portal/agents/telegraf
sudo cp -r . /etc/1line-agent/
```

### Start

```bash
cd /etc/1line-agent
docker compose --env-file .env up -d

# Verify
docker compose logs -f telegraf
docker compose logs -f cmd-handler
```

Within 15–30 seconds the agent card should appear **Online** in the portal with CPU/RAM/disk bars and container list.

---

## Step 3 — Deploy with systemd (no Docker on the VPS itself)

### Install Telegraf

```bash
# Debian / Ubuntu
curl -s https://repos.influxdata.com/influxdb.key | sudo apt-key add -
echo "deb https://repos.influxdata.com/debian stable main" | sudo tee /etc/apt/sources.list.d/influxdb.list
sudo apt update && sudo apt install -y telegraf
```

### Configure

```bash
sudo cp telegraf.conf /etc/telegraf/telegraf.conf
sudo cp -r scripts /etc/telegraf/scripts
sudo chmod +x /etc/telegraf/scripts/*.sh /etc/telegraf/scripts/*.py

# Set environment variables
sudo tee /etc/default/telegraf > /dev/null <<EOF
PORTAL_URL=https://your-portal.example.com
AGENT_ID=<uuid-from-portal>
AGENT_KEY=<key-from-portal>
EOF
sudo chmod 600 /etc/default/telegraf
```

### Add Telegraf to Docker group

```bash
sudo usermod -aG docker telegraf
```

### Start Telegraf

```bash
sudo systemctl enable --now telegraf
sudo journalctl -u telegraf -f
```

### Install command handler

```bash
pip3 install requests

sudo tee /etc/systemd/system/1line-cmd-handler.service > /dev/null <<'EOF'
[Unit]
Description=1line Portal Container Command Handler
After=network.target telegraf.service

[Service]
Type=simple
User=root
EnvironmentFile=/etc/default/telegraf
Environment=POLL_INTERVAL=5
ExecStart=/usr/bin/python3 /etc/telegraf/command-handler.py
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo cp command-handler.py /etc/telegraf/command-handler.py
sudo systemctl daemon-reload
sudo systemctl enable --now 1line-cmd-handler
sudo journalctl -u 1line-cmd-handler -f
```

---

## Architecture

```
VPS
├── Telegraf (15s interval)
│   ├── inputs.cpu / mem / disk / system  ──┐
│   ├── inputs.docker                       │  POST /api/containers/agents/{id}/telegraf
│   ├── inputs.exec (apt-updates.py, 1h)    ├─────────────────────────────────────────► Portal
│   ├── inputs.exec (failed-services.sh)    │                                           ◄── pending commands
│   ├── inputs.exec (recent-logins.py)   ───┘
│   └── outputs.http → portal
│
└── command-handler.py (every 5s)
    ├── POST /api/containers/agents/{id}/report  ← poll for commands
    └── docker start/stop/restart <container>
```

The two processes are **independent** — if `command-handler.py` is down, Telegraf still reports metrics. If Telegraf is down, commands still execute.

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `PORTAL_URL` | ✅ | Full portal URL, no trailing slash |
| `AGENT_ID` | ✅ | UUID from Register Agent dialog |
| `AGENT_KEY` | ✅ | API key shown once at registration |
| `DOCKER_GID` | Docker Compose only | GID of the `docker` group on the host |
| `POLL_INTERVAL` | ❌ (default: 5) | Seconds between command polls |

---

## Telegraf Portal Endpoint

`POST /api/containers/agents/{agent_id}/telegraf`

- **Auth**: `X-Agent-Key: <key>` header
- **Body**: Telegraf `outputs.http` JSON batch (`use_batch_format = true`)
- **Response**: same as `/report` — `{"ok": true, "pending_commands": [...]}`

The endpoint parses the Telegraf metric format and normalises it into the same internal structures used by all portal dashboards.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Agent offline after 75s | Check `journalctl -u telegraf` or `docker compose logs telegraf` |
| HTTP 401 | Wrong `AGENT_ID` or `AGENT_KEY` — re-register if unsure |
| HTTP 429 | `interval` in telegraf.conf is < 5s — keep at 15s |
| No containers | Telegraf not in docker group: `usermod -aG docker telegraf` then restart |
| No updates shown | `apt-updates.py` timed out — run it manually: `python3 /etc/telegraf/scripts/apt-updates.py` |
| Commands not executing | Check `1line-cmd-handler` service / `cmd-handler` container logs |
