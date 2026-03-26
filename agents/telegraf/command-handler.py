#!/usr/bin/env python3
"""
1line Portal — container command handler.

Runs as a companion to Telegraf. Polls the portal for pending container
commands (start / stop / restart) and executes them via Docker SDK or CLI.

Usage:
  export PORTAL_URL=https://your-portal.example.com
  export AGENT_ID=<uuid>
  export AGENT_KEY=<key>
  python3 command-handler.py
"""
import logging
import os
import subprocess
import time

import requests  # pip install requests

PORTAL_URL = os.environ["PORTAL_URL"].rstrip("/")
AGENT_ID   = os.environ["AGENT_ID"]
AGENT_KEY  = os.environ["AGENT_KEY"]
POLL_INTERVAL = int(os.environ.get("POLL_INTERVAL", "5"))  # seconds

HEADERS = {"X-Agent-Key": AGENT_KEY, "Content-Type": "application/json"}
SESSION = requests.Session()
SESSION.headers.update(HEADERS)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [cmd-handler] %(levelname)s %(message)s",
)
log = logging.getLogger(__name__)

ALLOWED_COMMANDS = {"start", "stop", "restart"}


def poll_commands() -> list[dict]:
    """POST an empty report to the /report endpoint just to get pending commands."""
    url = f"{PORTAL_URL}/api/containers/agents/{AGENT_ID}/report"
    resp = SESSION.post(url, json={"containers": []}, timeout=10)
    if resp.status_code == 429:
        return []  # rate-limited, skip this cycle
    resp.raise_for_status()
    return resp.json().get("pending_commands", [])


def execute_command(cmd: dict) -> tuple[str, str]:
    """Run a Docker command. Returns (status, message)."""
    command    = cmd.get("command", "")
    docker_id  = cmd.get("docker_id", "")
    name       = cmd.get("container_name") or docker_id

    if command not in ALLOWED_COMMANDS:
        return "failed", f"Unknown command: {command}"

    log.info("Executing: docker %s %s (%s)", command, docker_id, name)
    try:
        result = subprocess.run(
            ["docker", command, docker_id],
            capture_output=True, text=True, timeout=30,
        )
        if result.returncode == 0:
            return "done", f"docker {command} {name}: OK"
        else:
            return "failed", result.stderr.strip() or f"exit code {result.returncode}"
    except FileNotFoundError:
        return "failed", "docker CLI not found"
    except subprocess.TimeoutExpired:
        return "failed", "command timed out after 30s"
    except Exception as e:
        return "failed", str(e)


def post_result(cmd_id: str, status: str, message: str) -> None:
    url = f"{PORTAL_URL}/api/containers/agents/{AGENT_ID}/commands/{cmd_id}/result"
    try:
        SESSION.post(url, json={"status": status, "result_message": message}, timeout=10)
    except Exception as e:
        log.warning("Failed to post result for %s: %s", cmd_id, e)


def main() -> None:
    if not AGENT_ID or not AGENT_KEY:
        raise SystemExit("AGENT_ID and AGENT_KEY must be set")
    log.info("Starting — portal=%s  agent=%s  poll=%ds", PORTAL_URL, AGENT_ID, POLL_INTERVAL)

    while True:
        try:
            commands = poll_commands()
            for cmd in commands:
                status, message = execute_command(cmd)
                post_result(cmd["id"], status, message)
                log.info("%s → %s: %s", cmd.get("command"), status, message)
        except Exception as e:
            log.error("Cycle error: %s", e)
        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    main()
