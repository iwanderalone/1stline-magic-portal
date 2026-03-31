#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 1line Portal — Agent Auto-Deploy
#
# Usage (Docker Compose mode, recommended):
#   bash <(curl -fsSL https://raw.githubusercontent.com/iwanderalone/1stline-magic-portal/main/agents/telegraf/deploy.sh)
#
# Usage (systemd / no Docker on VPS):
#   bash <(curl -fsSL .../deploy.sh) --systemd
#
# The script will:
#   1. Ask for PORTAL_URL, AGENT_ID, AGENT_KEY
#   2. Download agent files from GitHub
#   3. Write /etc/1line-agent/.env
#   4. Start Telegraf + cmd-handler via Docker Compose  (default)
#      OR install Telegraf as a systemd service          (--systemd)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/iwanderalone/1stline-magic-portal/main/agents/telegraf"
INSTALL_DIR="/etc/1line-agent"
MODE="docker"   # docker | systemd

# ── Parse flags ──────────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --systemd) MODE="systemd" ;;
    --docker)  MODE="docker"  ;;
    *) echo "Unknown flag: $arg" >&2; exit 1 ;;
  esac
done

# ── Colour helpers ───────────────────────────────────────────────────────────
RED='\033[0;31m'; GRN='\033[0;32m'; YEL='\033[1;33m'; BLU='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLU}[info]${NC}  $*"; }
success() { echo -e "${GRN}[ok]${NC}    $*"; }
warn()    { echo -e "${YEL}[warn]${NC}  $*"; }
die()     { echo -e "${RED}[error]${NC} $*" >&2; exit 1; }

# ── Root check ───────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  die "Please run as root (sudo bash deploy.sh)"
fi

echo ""
echo -e "${BLU}╔══════════════════════════════════════════════╗${NC}"
echo -e "${BLU}║   1line Portal — Agent Installer             ║${NC}"
echo -e "${BLU}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ── Gather credentials ───────────────────────────────────────────────────────
echo "Enter the details from the portal (Admin → Containers → Register Agent)."
echo ""

read -rp "  Portal URL (e.g. https://portal.example.com): " PORTAL_URL
PORTAL_URL="${PORTAL_URL%/}"   # strip trailing slash

read -rp "  Agent UUID: " AGENT_ID
read -rp "  Agent API Key: " AGENT_KEY
echo ""

[[ -z "$PORTAL_URL" || -z "$AGENT_ID" || -z "$AGENT_KEY" ]] && die "All three values are required."

# ── Detect Docker GID (Docker mode only) ────────────────────────────────────
DOCKER_GID=""
if [[ "$MODE" == "docker" ]]; then
  if ! command -v docker &>/dev/null; then
    die "Docker not found. Install Docker first, or use --systemd for a non-Docker install."
  fi
  if ! command -v docker-compose &>/dev/null && ! docker compose version &>/dev/null 2>&1; then
    die "Docker Compose not found. Install it or use --systemd."
  fi
  DOCKER_GID=$(getent group docker | cut -d: -f3 2>/dev/null || echo "")
  if [[ -z "$DOCKER_GID" ]]; then
    warn "Could not auto-detect Docker GID. Enter it manually (run: getent group docker | cut -d: -f3):"
    read -rp "  Docker GID: " DOCKER_GID
  else
    info "Detected Docker GID: ${DOCKER_GID}"
  fi
fi

# ── Create install directory ─────────────────────────────────────────────────
info "Creating ${INSTALL_DIR} …"
mkdir -p "${INSTALL_DIR}/scripts"
chmod 700 "${INSTALL_DIR}"

# ── Write .env ───────────────────────────────────────────────────────────────
info "Writing ${INSTALL_DIR}/.env …"
cat > "${INSTALL_DIR}/.env" <<EOF
PORTAL_URL=${PORTAL_URL}
AGENT_ID=${AGENT_ID}
AGENT_KEY=${AGENT_KEY}
EOF
if [[ -n "$DOCKER_GID" ]]; then
  echo "DOCKER_GID=${DOCKER_GID}" >> "${INSTALL_DIR}/.env"
fi
chmod 600 "${INSTALL_DIR}/.env"
success ".env written"

# ── Download agent files ─────────────────────────────────────────────────────
info "Downloading agent files from GitHub …"

FILES=(
  "telegraf.conf"
  "docker-compose.yml"
  "command-handler.py"
  "scripts/apt-updates.py"
  "scripts/failed-services.sh"
  "scripts/recent-logins.py"
)

for f in "${FILES[@]}"; do
  dest="${INSTALL_DIR}/${f}"
  mkdir -p "$(dirname "$dest")"
  if curl -fsSL "${REPO_RAW}/${f}" -o "$dest"; then
    success "  ${f}"
  else
    die "Failed to download ${f}"
  fi
done

chmod +x "${INSTALL_DIR}/scripts/"*.sh "${INSTALL_DIR}/scripts/"*.py 2>/dev/null || true

# ── Docker Compose mode ──────────────────────────────────────────────────────
if [[ "$MODE" == "docker" ]]; then
  info "Starting agent via Docker Compose …"
  cd "${INSTALL_DIR}"

  # Support both old (docker-compose) and new (docker compose) CLI
  if command -v docker-compose &>/dev/null; then
    DC="docker-compose"
  else
    DC="docker compose"
  fi

  $DC --env-file .env pull --quiet
  $DC --env-file .env up -d

  echo ""
  success "Agent started!"
  echo ""
  echo -e "  Logs:  ${YEL}cd ${INSTALL_DIR} && docker compose logs -f telegraf${NC}"
  echo -e "  Stop:  ${YEL}cd ${INSTALL_DIR} && docker compose down${NC}"
  echo ""
  echo "The agent card should appear Online in the portal within 30 seconds."
fi

# ── systemd mode ─────────────────────────────────────────────────────────────
if [[ "$MODE" == "systemd" ]]; then
  # Install Telegraf
  if ! command -v telegraf &>/dev/null; then
    info "Installing Telegraf …"
    if command -v apt-get &>/dev/null; then
      curl -fsSL https://repos.influxdata.com/influxdb.key | apt-key add - 2>/dev/null
      echo "deb https://repos.influxdata.com/debian stable main" > /etc/apt/sources.list.d/influxdb.list
      apt-get update -qq
      apt-get install -y -qq telegraf
    elif command -v yum &>/dev/null; then
      cat > /etc/yum.repos.d/influxdb.repo <<'YUMEOF'
[influxdb]
name = InfluxDB Repository
baseurl = https://repos.influxdata.com/rhel/$releasever/$basearch/stable
enabled = 1
gpgcheck = 1
gpgkey = https://repos.influxdata.com/influxdb.key
YUMEOF
      yum install -y -q telegraf
    else
      die "Cannot auto-install Telegraf. Install it manually: https://docs.influxdata.com/telegraf/v1/install/"
    fi
    success "Telegraf installed"
  else
    info "Telegraf already installed ($(telegraf --version 2>&1 | head -1))"
  fi

  # Copy config and scripts
  info "Installing config and scripts …"
  cp "${INSTALL_DIR}/telegraf.conf" /etc/telegraf/telegraf.conf
  cp -r "${INSTALL_DIR}/scripts" /etc/telegraf/scripts
  chmod +x /etc/telegraf/scripts/*.sh /etc/telegraf/scripts/*.py

  # Write environment
  cat > /etc/default/telegraf <<EOF
PORTAL_URL=${PORTAL_URL}
AGENT_ID=${AGENT_ID}
AGENT_KEY=${AGENT_KEY}
EOF
  chmod 600 /etc/default/telegraf

  # Add telegraf to docker group if docker is present
  if command -v docker &>/dev/null; then
    usermod -aG docker telegraf 2>/dev/null && info "Added telegraf to docker group" || true
  fi

  # Enable and start Telegraf
  systemctl enable --now telegraf
  success "Telegraf service started"

  # Install command handler service
  info "Installing command handler service …"
  cp "${INSTALL_DIR}/command-handler.py" /etc/telegraf/command-handler.py

  if ! command -v pip3 &>/dev/null && ! command -v pip &>/dev/null; then
    warn "pip not found — installing python3-pip …"
    apt-get install -y -qq python3-pip 2>/dev/null || yum install -y python3-pip 2>/dev/null || true
  fi
  pip3 install requests --quiet 2>/dev/null || pip install requests --quiet 2>/dev/null || warn "Could not install 'requests' — install manually: pip3 install requests"

  cat > /etc/systemd/system/1line-cmd-handler.service <<'SVCEOF'
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
SVCEOF

  systemctl daemon-reload
  systemctl enable --now 1line-cmd-handler
  success "Command handler service started"

  echo ""
  success "Agent installed (systemd mode)!"
  echo ""
  echo -e "  Telegraf logs:  ${YEL}journalctl -u telegraf -f${NC}"
  echo -e "  Handler logs:   ${YEL}journalctl -u 1line-cmd-handler -f${NC}"
  echo ""
  echo "The agent card should appear Online in the portal within 30 seconds."
fi

echo ""
