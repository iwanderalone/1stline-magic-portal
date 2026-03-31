# Agent Deploy Guide

Full reference for deploying the 1line Portal VPS agent. For most cases the [one-liner](README.md#quick-deploy-recommended) is all you need.

---

## Prerequisites

- A running 1line Portal instance **served over HTTPS** — the agent sends credentials on every heartbeat and will refuse to start with a plain `http://` URL
- Root access on the VPS you want to monitor
- Internet access from the VPS to reach the portal

---

## Step 1 — Register the agent in the portal

1. Log in as admin → **Containers** sidebar item → **+ Register Agent**
2. Enter a name (e.g. `vps-berlin-01`) and optional description
3. Optionally assign a Telegram template for alerts
4. **Copy the API key** — it is shown only once
5. Note the Agent UUID shown in the agent list

---

## Step 2 — Deploy

### Option A — Auto-deploy script (recommended)

Run on the target VPS as root:

```bash
# Docker Compose mode (VPS has Docker)
bash <(curl -fsSL https://raw.githubusercontent.com/iwanderalone/1stline-magic-portal/main/agents/telegraf/deploy.sh)

# systemd mode (no Docker on the VPS)
bash <(curl -fsSL https://raw.githubusercontent.com/iwanderalone/1stline-magic-portal/main/agents/telegraf/deploy.sh) --systemd
```

The script will:
1. Prompt for `PORTAL_URL`, `AGENT_ID`, `AGENT_KEY`
2. Auto-detect the Docker GID (Docker mode)
3. Download all agent files from GitHub into `/etc/1line-agent/`
4. Write `/etc/1line-agent/.env` (mode 600)
5. Pull images and start services

Within 15–30 seconds the agent card appears **Online** in the portal.

---

### Option B — Manual Docker Compose

**1. Create install directory and `.env`**

```bash
sudo mkdir -p /etc/1line-agent
sudo tee /etc/1line-agent/.env > /dev/null <<EOF
PORTAL_URL=https://your-portal.example.com
AGENT_ID=<uuid-from-portal>
AGENT_KEY=<key-from-portal>
DOCKER_GID=$(getent group docker | cut -d: -f3)
EOF
sudo chmod 600 /etc/1line-agent/.env
```

**2. Download agent files**

```bash
sudo git clone https://github.com/iwanderalone/1stline-magic-portal /tmp/portal-repo
sudo cp -r /tmp/portal-repo/agents/telegraf/. /etc/1line-agent/
```

Or download individual files without git:

```bash
BASE="https://raw.githubusercontent.com/iwanderalone/1stline-magic-portal/main/agents/telegraf"
cd /etc/1line-agent
for f in telegraf.conf docker-compose.yml command-handler.py scripts/apt-updates.py scripts/failed-services.sh scripts/recent-logins.py; do
  mkdir -p "$(dirname $f)"
  curl -fsSL "$BASE/$f" -o "$f"
done
chmod +x scripts/*.sh scripts/*.py
```

**3. Start**

```bash
cd /etc/1line-agent
docker compose --env-file .env up -d

# Verify
docker compose logs -f telegraf
docker compose logs -f cmd-handler
```

---

### Option C — Manual systemd (no Docker on VPS)

**1. Install Telegraf**

```bash
# Debian / Ubuntu
curl -fsSL https://repos.influxdata.com/influxdb.key | sudo apt-key add -
echo "deb https://repos.influxdata.com/debian stable main" | sudo tee /etc/apt/sources.list.d/influxdb.list
sudo apt update && sudo apt install -y telegraf

# RHEL / CentOS / Rocky
sudo tee /etc/yum.repos.d/influxdb.repo > /dev/null <<'EOF'
[influxdb]
name = InfluxDB Repository
baseurl = https://repos.influxdata.com/rhel/$releasever/$basearch/stable
enabled = 1
gpgcheck = 1
gpgkey = https://repos.influxdata.com/influxdb.key
EOF
sudo yum install -y telegraf
```

**2. Download agent files**

```bash
BASE="https://raw.githubusercontent.com/iwanderalone/1stline-magic-portal/main/agents/telegraf"
sudo curl -fsSL "$BASE/telegraf.conf"              -o /etc/telegraf/telegraf.conf
sudo mkdir -p /etc/telegraf/scripts
for f in apt-updates.py failed-services.sh recent-logins.py container-logs.py; do
  sudo curl -fsSL "$BASE/scripts/$f" -o "/etc/telegraf/scripts/$f"
done
sudo chmod +x /etc/telegraf/scripts/*.sh /etc/telegraf/scripts/*.py
sudo curl -fsSL "$BASE/command-handler.py" -o /etc/telegraf/command-handler.py
```

**3. Set environment variables**

```bash
sudo tee /etc/default/telegraf > /dev/null <<EOF
PORTAL_URL=https://your-portal.example.com
AGENT_ID=<uuid-from-portal>
AGENT_KEY=<key-from-portal>
EOF
sudo chmod 600 /etc/default/telegraf
```

**4. Add Telegraf to the Docker group (if Docker is present)**

```bash
sudo usermod -aG docker telegraf
```

**5. Start Telegraf**

```bash
sudo systemctl enable --now telegraf
sudo journalctl -u telegraf -f
```

**6. Install command handler as a systemd service**

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

sudo systemctl daemon-reload
sudo systemctl enable --now 1line-cmd-handler
sudo journalctl -u 1line-cmd-handler -f
```

---

## Updating the agent

```bash
# Docker Compose
cd /etc/1line-agent
docker compose pull
docker compose up -d

# systemd — re-run the download commands from Step 2, then:
sudo systemctl restart telegraf 1line-cmd-handler
```

---

## Removing the agent

```bash
# Docker Compose
cd /etc/1line-agent
docker compose down
sudo rm -rf /etc/1line-agent

# systemd
sudo systemctl disable --now telegraf 1line-cmd-handler
sudo rm /etc/systemd/system/1line-cmd-handler.service
sudo rm /etc/telegraf/telegraf.conf /etc/telegraf/command-handler.py
sudo rm -rf /etc/telegraf/scripts
sudo systemctl daemon-reload
```

Then delete the agent from the portal: Admin → Containers → agent menu → Delete.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Deploy script rejects URL | `PORTAL_URL` must start with `https://` — plain HTTP is blocked |
| cmd-handler refuses to start | Same — check `PORTAL_URL` in `.env` starts with `https://` |
| Agent offline after 75s | Check `journalctl -u telegraf` or `docker compose logs telegraf` |
| HTTP 401 | Wrong `AGENT_ID` or `AGENT_KEY` — re-register if unsure |
| HTTP 429 | `interval` in telegraf.conf is < 5s — keep at 15s |
| No containers shown | Telegraf not in docker group: `usermod -aG docker telegraf` then restart |
| No updates shown | `apt-updates.py` timed out — test manually: `python3 /etc/telegraf/scripts/apt-updates.py` |
| No container logs | First batch appears ~2 min after deploy; test: `python3 /etc/telegraf/scripts/container-logs.py` |
| Commands show "no response from agent" | `cmd-handler` not running — check `docker compose logs cmd-handler` or `journalctl -u 1line-cmd-handler` |
| Commands show "failed: …" | Error message is from `docker` itself — container may already be in the target state |
| CPU/mem bars missing | Telegraf running but Docker socket not mounted — check `docker compose logs telegraf` |
| Can't reach portal | Verify `PORTAL_URL` has no trailing slash: `curl $PORTAL_URL/api/health` |
