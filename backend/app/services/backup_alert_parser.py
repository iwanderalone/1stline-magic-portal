"""Parser for Proxmox vzdump backup status emails."""
import re
from dataclasses import dataclass


@dataclass
class BackupEntry:
    vmid: str
    name: str
    status: str
    duration: str
    size: str
    filename: str


@dataclass
class BackupSummary:
    host: str
    status: str
    entries: list[BackupEntry]
    total_time: str
    total_size: str


def _extract_backup_host(subject: str, sender: str) -> str:
    subject_match = re.search(r"vzdump backup status \(([^)]+)\)", subject, re.I)
    if subject_match:
        return subject_match.group(1).strip()
    sender_match = re.search(r"root@([^>\s]+)", sender)
    return sender_match.group(1).strip() if sender_match else "unknown host"


def _parse_backup_details_table(body: str) -> tuple[list[BackupEntry], str, str]:
    details_match = re.search(r"Details\s*=+\s*(.*?)(?:\n\s*Logs\s*=+|\Z)", body, re.S | re.I)
    if not details_match:
        return [], "", ""

    entries: list[BackupEntry] = []
    total_time = ""
    total_size = ""
    for raw_line in details_match.group(1).splitlines():
        line = raw_line.strip()
        if not line or line.startswith("VMID"):
            continue

        total_time_match = re.match(r"Total running time:\s*(.+)", line, re.I)
        if total_time_match:
            total_time = total_time_match.group(1).strip()
            continue

        total_size_match = re.match(r"Total size:\s*(.+)", line, re.I)
        if total_size_match:
            total_size = total_size_match.group(1).strip()
            continue

        match = re.match(
            r"^(\d+)\s+(\S+)\s+(\S+)\s+(.+?)\s+(\d+(?:\.\d+)?\s+\S+i?B)\s+(\S+)\s*$",
            line,
        )
        if match:
            entries.append(
                BackupEntry(
                    vmid=match.group(1),
                    name=match.group(2),
                    status=match.group(3),
                    duration=match.group(4).strip(),
                    size=match.group(5),
                    filename=match.group(6),
                )
            )

    return entries, total_time, total_size


def _normalize_backup_status(subject: str, entries: list[BackupEntry]) -> str:
    lowered = subject.lower()
    if any(entry.status.lower() not in {"ok", "success", "successful"} for entry in entries):
        return "failed"
    if "failed" in lowered or "error" in lowered:
        return "failed"
    if "successful" in lowered or "success" in lowered:
        return "successful"
    return "unknown"


def parse_backup_alert(subject: str, sender: str, body: str) -> BackupSummary:
    entries, total_time, total_size = _parse_backup_details_table(body)
    return BackupSummary(
        host=_extract_backup_host(subject, sender),
        status=_normalize_backup_status(subject, entries),
        entries=entries,
        total_time=total_time,
        total_size=total_size,
    )
