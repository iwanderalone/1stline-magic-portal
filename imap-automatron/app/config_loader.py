import json
import logging
from dataclasses import dataclass
from datetime import date
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class RoutingRule:
    name: str
    match_type: str
    match_values: list[str]
    label: str
    hashtag: str
    mention_users: str
    include_body: bool
    telegram_target: str
    priority: int


@dataclass
class CatchAll:
    label: str
    hashtag: str
    mention_users: str
    include_body: bool


@dataclass
class MailboxConfig:
    email: str
    password: str
    imap_server: str
    imap_port: int
    subject_filter: str
    default_telegram_target: str
    monitor_since: date
    rules: list[RoutingRule]
    catch_all: Optional[CatchAll]


def load_config(path: str) -> list[MailboxConfig]:
    with open(path) as f:
        data = json.load(f)

    raw_mailboxes = data.get("mailboxes", [])
    if not raw_mailboxes:
        raise ValueError("config.json must define at least one mailbox")

    mailboxes: list[MailboxConfig] = []

    for mb in raw_mailboxes:
        for required in ("email", "password", "imap_server", "default_telegram_target"):
            if not mb.get(required):
                raise ValueError(f"Mailbox missing required field: '{required}'")

        rules: list[RoutingRule] = []
        for r in mb.get("rules", []):
            rules.append(RoutingRule(
                name=r["name"],
                match_type=r["match_type"],
                match_values=r.get("match_values", []),
                label=r.get("label", "📩 Email"),
                hashtag=r.get("hashtag", ""),
                mention_users=r.get("mention_users", ""),
                include_body=r.get("include_body", True),
                telegram_target=r.get("telegram_target", ""),
                priority=r.get("priority", 100),
            ))
        rules.sort(key=lambda r: r.priority)

        raw_ca = mb.get("catch_all")
        catch_all: Optional[CatchAll] = None
        if raw_ca:
            catch_all = CatchAll(
                label=raw_ca.get("label", "📩 General"),
                hashtag=raw_ca.get("hashtag", "#email"),
                mention_users=raw_ca.get("mention_users", ""),
                include_body=raw_ca.get("include_body", True),
            )

        mailboxes.append(MailboxConfig(
            email=mb["email"],
            password=mb["password"],
            imap_server=mb["imap_server"],
            imap_port=mb.get("imap_port", 993),
            subject_filter=mb.get("subject_filter", ""),
            default_telegram_target=mb["default_telegram_target"],
            monitor_since=date.fromisoformat(mb.get("monitor_since", "2000-01-01")),
            rules=rules,
            catch_all=catch_all,
        ))

    return mailboxes
