#!/usr/bin/env python3
"""
Output: JSON array of recent login events (last 15 entries from `last`).
Telegraf reads this via inputs.exec (data_format = "value", data_type = "string").
Portal metric name: recent_logins

Runs `last` in the host's namespaces via nsenter so we read the host's
/var/log/wtmp rather than the container's (empty) one.
"""
import json
import re
import subprocess
import sys

IP_RE = re.compile(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$")

# nsenter -t 1 enters all namespaces of the host init process (PID 1).
cmd = ["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--",
       "last", "-n", "15", "-F"]

try:
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=5)
except Exception:
    print("[]")
    sys.exit(0)

logins = []
for line in r.stdout.splitlines():
    if not line.strip() or line.startswith("wtmp") or line.startswith("reboot"):
        continue
    parts = line.split()
    if len(parts) < 3:
        continue
    username = parts[0]
    source   = parts[2]  # IP address or tty name
    ip = source if IP_RE.match(source) else ""
    # Build a unique session ID from username + source + login timestamp (parts 3-7 with -F).
    # This lets the portal distinguish two logins by the same user from the same IP.
    timestamp = " ".join(parts[3:8]) if len(parts) >= 8 else ""
    logins.append({
        "username":   username,
        "ip":         ip,
        "timestamp":  timestamp,
        "session_id": f"{username}@{source}@{timestamp}",
        "event_type": "login",
    })
    if len(logins) >= 10:
        break

print(json.dumps(logins))
