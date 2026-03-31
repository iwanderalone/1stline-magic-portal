#!/bin/sh
# Output: comma-separated list of failed systemd unit names, or empty string.
# Telegraf reads this via inputs.exec (data_format = "value", data_type = "string").
# Portal metric name: systemd_failed
#
# Runs systemctl in the host's namespaces via nsenter so the Telegraf container
# does not need systemd installed.

result=$(nsenter -t 1 -m -u -i -n -p -- \
  systemctl list-units --failed --no-legend --no-pager 2>/dev/null \
  | awk '{print $1}' \
  | paste -sd,) || true

echo "${result:-}"
