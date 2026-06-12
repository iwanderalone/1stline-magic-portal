from datetime import datetime, timezone

from app.services.backup_alert_parser import parse_backup_alert
from app.services.mail_reporter_service import classify_email, format_message


BACKUP_BODY = """
Details
=======
VMID    Name          Status    Time      Size           Filename
1000    vm-dev        ok        2m 41s    128.001 GiB    vm/1000/2026-06-12T01:00:03Z
1003    vm-scripts    ok        18s       108.001 GiB    vm/1003/2026-06-12T01:02:44Z

Total running time: 3m
Total size: 236.001 GiB

Logs
====
verbose backup log follows
"""


def test_parse_backup_alert_extracts_summary():
    summary = parse_backup_alert(
        "vzdump backup status (ds-de-01.corp.viory.video): backup successful",
        "vzdump backup tool <root@ds-de-01.corp.viory.video>",
        BACKUP_BODY,
    )

    assert summary.host == "ds-de-01.corp.viory.video"
    assert summary.status == "successful"
    assert summary.total_time == "3m"
    assert summary.total_size == "236.001 GiB"
    assert [(entry.vmid, entry.name, entry.status) for entry in summary.entries] == [
        ("1000", "vm-dev", "ok"),
        ("1003", "vm-scripts", "ok"),
    ]


def test_classify_email_routes_vzdump_subject_to_backup_alerts():
    category, extra = classify_email(
        "vzdump backup tool <root@pve.example>",
        "daily vzdump backup status (pve.example): backup successful",
        BACKUP_BODY,
        raw_text=BACKUP_BODY,
    )

    assert category == "backup_alerts"
    assert extra["summary"].host == "pve.example"


def test_format_message_compacts_backup_alert_and_highlights_failures():
    failed_body = BACKUP_BODY.replace(
        "1003    vm-scripts    ok        18s",
        "1003    vm-scripts    failed    18s",
    )
    category, extra = classify_email(
        "vzdump backup tool <root@pve.example>",
        "vzdump backup status (pve.example): backup successful",
        failed_body,
        raw_text=failed_body,
    )

    message = format_message(
        category,
        extra,
        "vzdump backup tool <root@pve.example>",
        "admin@example.com",
        "vzdump backup status (pve.example): backup successful",
        datetime(2026, 6, 12, 1, 3, tzinfo=timezone.utc),
        failed_body,
        "admin@example.com",
        display={
            "label": "Backup Alerts",
            "hashtag": "#backup",
            "mention_users": "",
            "include_body": False,
        },
    )

    assert "Proxmox backup failed" in message
    assert "<b>Host:</b> pve.example" in message
    assert "<b>VMs:</b> 1/2 ok" in message
    assert "<b>Total:</b> 236.001 GiB in 3m" in message
    assert "1003 vm-scripts: failed" in message
    assert "verbose backup log follows" not in message
