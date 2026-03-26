#!/usr/bin/env python3
"""
Output: JSON array of pending apt updates.
Telegraf reads this via inputs.exec (data_format = "value", data_type = "string").
Portal metric name: apt_updates
"""
import json
import os
import re
import subprocess
import sys

env = {**os.environ, "LANG": "C", "DEBIAN_FRONTEND": "noninteractive"}
try:
    r = subprocess.run(
        ["apt", "list", "--upgradable"],
        capture_output=True, text=True, timeout=45, env=env,
    )
except FileNotFoundError:
    # Not a Debian/Ubuntu system — output empty list silently
    print("[]")
    sys.exit(0)
except Exception as e:
    print("[]", file=sys.stderr)
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
