#!/usr/bin/env python3
"""
Output: JSON array of pending apt updates.
Telegraf reads this via inputs.exec (data_format = "value", data_type = "string").
Portal metric name: apt_updates

Runs `apt list --upgradable` in the host's namespaces via nsenter so the
Telegraf container does not need apt installed.
"""
import json
import os
import re
import subprocess
import sys

env = {**os.environ, "LANG": "C", "DEBIAN_FRONTEND": "noninteractive"}

# nsenter -t 1 enters all namespaces of the host init process (PID 1),
# giving us the host filesystem where apt actually lives.
cmd = ["nsenter", "-t", "1", "-m", "-u", "-i", "-n", "-p", "--",
       "apt", "list", "--upgradable"]

try:
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=45, env=env)
except FileNotFoundError:
    # nsenter or apt not available — not a Debian/Ubuntu host
    print("[]")
    sys.exit(0)
except Exception:
    print("[]")
    sys.exit(0)

updates = []
pattern = re.compile(r"^([^/]+)/\S+\s+(\S+)\s+\S+\s+\[upgradable from:\s+(\S+)\]")
for line in r.stdout.splitlines()[1:]:  # skip "Listing..." header
    m = pattern.match(line)
    if m:
        updates.append({
            "package":         m.group(1),
            "new_version":     m.group(2),
            "current_version": m.group(3),
        })

print(json.dumps(updates))
