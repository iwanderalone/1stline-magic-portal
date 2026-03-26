#!/usr/bin/env python3
"""
Output: JSON array of recent login events (last 15 entries from `last`).
Telegraf reads this via inputs.exec (data_format = "value", data_type = "string").
Portal metric name: recent_logins
"""
import json
import re
import subprocess
import sys

IP_RE = re.compile(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$")

try:
    r = subprocess.run(
        ["last", "-n", "15", "-F"],
        capture_output=True, text=True, timeout=5,
    )
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
    logins.append({
        "username":   username,
        "ip":         ip,
        "event_type": "login",
    })
    if len(logins) >= 10:
        break

print(json.dumps(logins))
