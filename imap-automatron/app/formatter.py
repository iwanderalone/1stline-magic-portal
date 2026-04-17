from datetime import datetime
from typing import Union
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.config_loader import CatchAll, RoutingRule


def escape_html(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def format_message(
    email: dict,
    display: Union[RoutingRule, CatchAll],
    mailbox_email: str,
    timezone_str: str = "UTC",
) -> str:
    """Build a Telegram HTML message from a parsed email and display config."""
    try:
        tz = ZoneInfo(timezone_str)
    except ZoneInfoNotFoundError:
        tz = ZoneInfo("UTC")

    timestamp: datetime = email["timestamp"]
    local_time = timestamp.astimezone(tz).strftime("%Y-%m-%d %H:%M")

    safe_subject  = escape_html(email["subject"])
    safe_sender   = escape_html(email["sender"])
    safe_recipient = escape_html(email["recipient"])
    safe_body     = escape_html(email["body"])
    safe_mailbox  = escape_html(mailbox_email)

    label    = display.label or "📩 Email"
    hashtag  = display.hashtag or ""
    mentions = (display.mention_users or "").strip()
    inc_body = display.include_body

    header = label
    if hashtag:
        header += f" <b>{escape_html(hashtag)}</b>"

    mention_line = f"{mentions}\n" if mentions else ""
    body_section = f"\n{safe_body}" if inc_body else ""

    return (
        f"{header}\n"
        f"{mention_line}"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"<b>From:</b> {safe_sender}\n"
        f"<b>To:</b> {safe_recipient}\n"
        f"<b>Subject:</b> {safe_subject}\n"
        f"<b>Mailbox:</b> {safe_mailbox}\n"
        f"🕐 {local_time}"
        f"{body_section}"
    )
