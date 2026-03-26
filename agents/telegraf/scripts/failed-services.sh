#!/bin/sh
# Output: comma-separated list of failed systemd unit names, or empty string.
# Telegraf reads this via inputs.exec (data_format = "value", data_type = "string").
# Portal metric name: systemd_failed

result=$(systemctl list-units --failed --no-legend --no-pager 2>/dev/null \
  | awk '{print $1}' \
  | paste -sd,) || true

echo "${result:-}"
