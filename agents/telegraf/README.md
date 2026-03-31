# 1line Portal — VPS Agent

Monitors a VPS and reports metrics to the portal. Consists of two independent processes:

- **Telegraf** — collects system + Docker metrics every 15s, pushes to portal
- **command-handler.py** — polls portal every 5s, executes container start/stop/restart

> This only installs the **monitoring agent**. The portal itself runs separately on your main server.

---

## Quick deploy (recommended)

On the VPS you want to monitor, run as root:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/iwanderalone/1stline-magic-portal/main/agents/telegraf/deploy.sh)
```

The script will ask for your portal URL, Agent ID, and API key, then install everything automatically.

For a VPS without Docker:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/iwanderalone/1stline-magic-portal/main/agents/telegraf/deploy.sh) --systemd
```

See [agent-deploy.md](agent-deploy.md) for the full manual setup guide and all options.

---

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
| `scripts/container-logs.py` | Last 15 log lines per running container | 2m |

---

## Telegram alerts

Configure a Telegram template in the portal (Admin → Telegram Templates), then assign it to the agent (Containers → Edit Agent). Per-agent toggles:

| Alert | Trigger | Cooldown |
|---|---|---|
| 🔴 VPS offline | No heartbeat for 5 min | 1h |
| ✅ VPS back online | Agent reports in after offline alert | — |
| 🔥 CPU spike | CPU ≥ threshold for ~45s | 30 min |
| 💾 Disk full | Disk ≥ threshold | 1h |
| 🚨 Container stopped | Running → exited/dead/oom_killed | — |
| 👤 SSH login | New login detected | — |
| ⬆️ OS updates | New pending packages | 24h |

Each alert type can be individually enabled/disabled per agent.

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

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `PORTAL_URL` | ✅ | Full portal URL, no trailing slash |
| `AGENT_ID` | ✅ | UUID from Register Agent dialog |
| `AGENT_KEY` | ✅ | API key shown once at registration |
| `DOCKER_GID` | Docker Compose only | GID of the `docker` group on the host |
| `POLL_INTERVAL` | ❌ (default: 5) | Seconds between command polls |

---

## Security

- `PORTAL_URL` **must** use `https://` — the deploy script and command-handler both refuse to start with plain HTTP. The agent sends credentials on every heartbeat.
- The agent makes **outbound-only** connections to the portal. No ports are opened on the VPS.
- Container commands are limited to `start`, `stop`, `restart` — no arbitrary shell execution.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Deploy script rejects URL | `PORTAL_URL` must start with `https://` |
| Agent offline after 75s | Check `journalctl -u telegraf` or `docker compose logs telegraf` |
| HTTP 401 | Wrong `AGENT_ID` or `AGENT_KEY` — re-register if unsure |
| HTTP 429 | `interval` in telegraf.conf is < 5s — keep at 15s |
| No containers shown | Telegraf not in docker group: `usermod -aG docker telegraf` then restart |
| No updates shown | `apt-updates.py` timed out — run manually: `python3 /etc/telegraf/scripts/apt-updates.py` |
| No container logs | First logs appear ~2 min after deploy; check `docker compose logs telegraf` for exec errors |
| Commands show "no response" | `cmd-handler` container not running — check `docker compose logs cmd-handler` |
| Commands show "failed" | Check the error message in the toast; container may already be in target state |
