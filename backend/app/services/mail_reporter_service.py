"""Mail Reporter Service — IMAP polling, classification, and Telegram delivery.

Ported from ultimate-mail-reporter-3000/bot.py and adapted for async portal context.
IMAP operations (blocking I/O) run inside asyncio.to_thread() to avoid blocking
the portal's event loop.
"""
import asyncio
import hashlib
import imaplib
import email as email_lib
import logging
import re
from datetime import datetime, date, timezone
from email.header import decode_header
from email.utils import parsedate_to_datetime
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from bs4 import BeautifulSoup
from sqlalchemy import select, desc

from app.core.config import get_settings
from app.core.database import AsyncSessionFactory
from app.models.models import MailboxConfig, EmailLog

logger = logging.getLogger(__name__)


# ─── Classification Patterns ──────────────────────────────────────────

ONBOARDING_KEYWORDS = [
    "onboarding", "new employee", "new hire", "create account",
    "make account", "new user", "employee joining", "welcome aboard",
    "start date", "first day", "new joiner", "new staff",
    "give access", "grant access",
]
OFFBOARDING_KEYWORDS = [
    "offboarding", "termination", "employee leaving", "deactivate account",
    "delete account", "disable account", "last day", "resignation",
    "employee departure", "remove access", "exit process",
    "deactivation", "revoke access",
]
YANDEX_SUPPORT_SENDER = "support-team@360.yandex.ru"

ADOBE_TEXT_CODE_PATTERNS = [
    re.compile(r"(?:verification\s*code|adobe\s*code|your\s*code\s*is|one.time\s*(?:pass)?code)[:\s]*(\d{4,8})", re.I),
    re.compile(r"(\d{4,8})\s*(?:is\s*your\s*(?:adobe\s*)?(?:verification\s*)?code)", re.I),
    re.compile(r"(?:code)[:\s]+(\d{4,8})", re.I),
    re.compile(r"(?:use|enter|input|type)\s+(\d{4,8})\b", re.I),
    re.compile(r"^\s*(\d{4,8})\s*$", re.M),
]

_CLEANUP_PATTERNS = [
    re.compile(r"\[image\s*:+[^\]]*\]", re.I),
    re.compile(r"\[https?://[^\]]+\]"),
    re.compile(r"<https?://[^>]+>"),
    re.compile(r"(https?://\S+)\s+\1", re.I),
    re.compile(r"^https?://\S*(?:click|track|open|pixel|unsub|beacon|redirect)\S*$", re.I | re.M),
]
_BARE_URL_LINE = re.compile(r"^https?://\S+$")


# ─── Utility functions ────────────────────────────────────────────────

def _make_fingerprint(msg_id: str, mailbox_email: str) -> str:
    raw = f"{mailbox_email}:{msg_id}".encode()
    return hashlib.sha256(raw).hexdigest()[:24]


def escape_html(text: str) -> str:
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def safe_decode_header(raw) -> str:
    if raw is None:
        return "Unknown"
    parts = decode_header(raw)
    decoded = []
    for fragment, charset in parts:
        if isinstance(fragment, bytes):
            try:
                decoded.append(fragment.decode(charset or "utf-8", errors="replace"))
            except (LookupError, UnicodeDecodeError):
                decoded.append(fragment.decode("utf-8", errors="replace"))
        else:
            decoded.append(fragment)
    return " ".join(decoded)


# ─── Body Cleaning ────────────────────────────────────────────────────

def clean_email_body(raw: str, content_type: str = "text/html") -> str:
    if content_type == "text/plain":
        text = BeautifulSoup(raw, "html.parser").get_text(separator="\n")
    else:
        soup = BeautifulSoup(raw, "html.parser")
        for tag in soup(["script", "style", "img", "picture", "video",
                         "audio", "iframe", "object", "embed", "svg",
                         "noscript", "map", "area"]):
            tag.decompose()
        for a_tag in soup.find_all("a"):
            link_text = a_tag.get_text()
            if link_text.strip():
                a_tag.replace_with(link_text)
            else:
                a_tag.decompose()
        text = soup.get_text(separator="\n")

    for pattern in _CLEANUP_PATTERNS:
        text = pattern.sub("", text)

    lines = [line.strip() for line in text.splitlines()]
    cleaned = []
    blank_count = 0
    seen_urls: set = set()
    for line in lines:
        if not line:
            blank_count += 1
            if blank_count <= 1:
                cleaned.append("")
            continue
        blank_count = 0
        if _BARE_URL_LINE.match(line):
            url_normalized = line.rstrip("/").lower()
            if url_normalized in seen_urls:
                continue
            seen_urls.add(url_normalized)
        else:
            for url_match in re.finditer(r"https?://\S+", line):
                seen_urls.add(url_match.group().rstrip("/").lower())
        cleaned.append(line)

    while cleaned and (not cleaned[-1] or _BARE_URL_LINE.match(cleaned[-1])):
        cleaned.pop()

    result = "\n".join(cleaned).strip()
    if len(result) > 3000:
        result = result[:3000] + "\n\n[… message truncated]"
    return result


# ─── Body Extraction ─────────────────────────────────────────────────

def _get_raw_parts(msg) -> tuple[str, str]:
    html_parts, text_parts = [], []
    if msg.is_multipart():
        for part in msg.walk():
            disp = str(part.get("Content-Disposition", ""))
            if "attachment" in disp:
                continue
            ct = part.get_content_type()
            if ct not in ("text/plain", "text/html"):
                continue
            try:
                payload = part.get_payload(decode=True)
                if payload is None:
                    continue
                charset = part.get_content_charset() or "utf-8"
                decoded = payload.decode(charset, errors="replace")
            except Exception:
                continue
            if ct == "text/html":
                html_parts.append(decoded)
                text_parts.append(BeautifulSoup(decoded, "html.parser").get_text(separator=" "))
            else:
                text_parts.append(decoded)
    else:
        try:
            payload = msg.get_payload(decode=True)
            charset = msg.get_content_charset() or "utf-8"
            decoded = payload.decode(charset, errors="replace")
            if msg.get_content_type() == "text/html":
                html_parts.append(decoded)
                text_parts.append(BeautifulSoup(decoded, "html.parser").get_text(separator=" "))
            else:
                text_parts.append(decoded)
        except Exception:
            pass
    return "\n".join(html_parts), "\n".join(text_parts)


def extract_body(msg) -> str:
    plain_body = None
    html_body = None
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            if "attachment" in str(part.get("Content-Disposition", "")):
                continue
            try:
                payload = part.get_payload(decode=True)
                if payload is None:
                    continue
                charset = part.get_content_charset() or "utf-8"
                text = payload.decode(charset, errors="replace")
            except Exception:
                continue
            if ct == "text/plain" and plain_body is None:
                plain_body = clean_email_body(text, "text/plain")
            elif ct == "text/html" and html_body is None:
                html_body = clean_email_body(text, "text/html")
    else:
        try:
            payload = msg.get_payload(decode=True)
            charset = msg.get_content_charset() or "utf-8"
            text = payload.decode(charset, errors="replace")
            return clean_email_body(text, msg.get_content_type())
        except Exception:
            return "[Could not decode email body]"
    return plain_body or html_body or "[Empty message body]"


# ─── Adobe Code Extraction ────────────────────────────────────────────

def _extract_adobe_code_from_html(html: str) -> Optional[str]:
    try:
        soup = BeautifulSoup(html, "html.parser")
        for tag in soup.find_all(["td", "span", "div", "p", "b", "strong", "h1", "h2", "h3"]):
            text = tag.get_text(strip=True)
            if re.fullmatch(r"\d{4,8}", text):
                if 2020 <= int(text) <= 2035 and len(text) == 4:
                    continue
                return text
        m = re.search(r"<(?:td|span|div|p|b|strong)\b[^>]*>\s*(\d{4,8})\s*</", html, re.I | re.S)
        if m:
            val = m.group(1)
            if not (2020 <= int(val) <= 2035 and len(val) == 4):
                return val
    except Exception:
        pass
    return None


def _extract_adobe_code_from_text(text: str) -> Optional[str]:
    for pattern in ADOBE_TEXT_CODE_PATTERNS:
        m = pattern.search(text)
        if m:
            return m.group(1)
    return None


# ─── Classification ───────────────────────────────────────────────────

def classify_email(sender: str, subject: str, body: str,
                   raw_html: str = "", raw_text: str = "") -> tuple[str, dict]:
    full_text = f"{subject} {body}"
    all_text = f"{subject} {sender} {body} {raw_text}".lower()

    is_adobe = (
        "adobe" in subject.lower()
        or "adobe" in sender.lower()
        or "@adobe.com" in sender.lower()
        or ("adobe" in all_text and ("verif" in all_text or "code" in all_text))
    )
    if is_adobe:
        code = None
        if raw_html:
            code = _extract_adobe_code_from_html(raw_html)
        if not code:
            code = _extract_adobe_code_from_text(subject)
        if not code and raw_text:
            code = _extract_adobe_code_from_text(raw_text)
        if not code:
            code = _extract_adobe_code_from_text(body)
        if code:
            return "adobe", {"code": code}
        logger.warning(
            f"Adobe email detected but no code extracted. "
            f"Subject: '{subject}' | Sender: '{sender}' | "
            f"HTML: {len(raw_html)}ch | Text: {len(raw_text)}ch | "
            f"Body preview: '{body[:200]}'"
        )
        return "adobe", {"code": "see email"}

    if YANDEX_SUPPORT_SENDER.lower() in sender.lower():
        return "yandex_support", {}

    text_lower = full_text.lower()
    is_onboard = any(kw in text_lower for kw in ONBOARDING_KEYWORDS)
    is_offboard = any(kw in text_lower for kw in OFFBOARDING_KEYWORDS)
    if is_onboard and is_offboard:
        return "onboarding_offboarding", {}
    if is_onboard:
        return "onboarding", {}
    if is_offboard:
        return "offboarding", {}

    return "general", {}


# ─── Message Formatting ───────────────────────────────────────────────

def format_message(category: str, extra: dict, sender: str, recipient: str,
                   subject: str, timestamp: datetime, body: str, mailbox_email: str) -> str:
    settings = get_settings()
    try:
        local_tz = ZoneInfo(settings.PORTAL_TIMEZONE)
    except ZoneInfoNotFoundError:
        local_tz = ZoneInfo("UTC")
    local_time = timestamp.astimezone(local_tz).strftime("%Y-%m-%d %H:%M")

    safe_subject = escape_html(subject)
    safe_sender = escape_html(sender)
    safe_recipient = escape_html(recipient)
    safe_body = escape_html(body)
    safe_mailbox = escape_html(mailbox_email)

    if category == "adobe":
        code = extra.get("code", "N/A")
        return (
            f"🔴 <b>#adobe</b>\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"New Adobe Code: <code>{escape_html(code)}</code>\n"
            f"Mailbox: {safe_mailbox}\n"
            f"🕐 {local_time}"
        )

    if category in ("onboarding", "offboarding", "onboarding_offboarding"):
        if category == "onboarding":
            label = "New Onboarding request"
        elif category == "offboarding":
            label = "New Offboarding request"
        else:
            label = "New Onboarding / Offboarding request"
        return (
            f"🔵 <b>#onboarding #offboarding</b>\n"
            f"@wanderalone @itsupport_viory\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"{label}\n\n"
            f"<b>From:</b> {safe_sender}\n"
            f"<b>To:</b> {safe_recipient}\n"
            f"<b>Subject:</b> {safe_subject}\n"
            f"🕐 {local_time}\n\n"
            f"{safe_body}"
        )

    if category == "yandex_support":
        return (
            f"🟡 <b>#yandexsupport</b>\n"
            f"@itsupport_viory\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"Yandex 360 Support\n\n"
            f"<b>From:</b> {safe_sender}\n"
            f"<b>To:</b> {safe_recipient}\n"
            f"<b>Subject:</b> {safe_subject}\n"
            f"🕐 {local_time}\n\n"
            f"{safe_body}"
        )

    return (
        f"📩 <b>#email</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"<b>From:</b> {safe_sender}\n"
        f"<b>To:</b> {safe_recipient}\n"
        f"<b>Subject:</b> {safe_subject}\n"
        f"🕐 {local_time}\n\n"
        f"{safe_body}"
    )


# ─── Telegram Target Resolution ───────────────────────────────────────

def _resolve_target(telegram_target: str) -> tuple[str, str]:
    """Parse target string → (chat_id, thread_id). Falls back to global config."""
    settings = get_settings()
    target = (telegram_target or "").strip()
    if not target:
        return settings.MAIL_DEFAULT_CHAT_ID, settings.MAIL_DEFAULT_THREAD_ID
    if ":" in target:
        parts = target.split(":", 1)
        return parts[0].strip(), parts[1].strip()
    return target, ""


# ─── IMAP Sync (runs in thread executor) ─────────────────────────────

def _connect_imap(email_addr: str, password: str) -> imaplib.IMAP4_SSL:
    settings = get_settings()
    mail = imaplib.IMAP4_SSL(settings.MAIL_IMAP_SERVER, settings.MAIL_IMAP_PORT,
                              timeout=settings.MAIL_IMAP_TIMEOUT)
    mail.login(email_addr, password)
    return mail


def _test_imap_connection(email_addr: str, password: str) -> dict:
    """Try to connect to IMAP and return result. Runs in thread executor."""
    try:
        mail = _connect_imap(email_addr, password)
        mail.select("INBOX", readonly=True)
        mail.logout()
        return {"success": True, "message": f"Connected to INBOX for {email_addr}"}
    except imaplib.IMAP4.error as e:
        return {"success": False, "message": f"IMAP auth/protocol error: {e}"}
    except (OSError, TimeoutError) as e:
        return {"success": False, "message": f"Connection failed: {e}"}
    except Exception as e:
        return {"success": False, "message": f"Unexpected error: {e}"}


def _fetch_imap_emails(email_addr: str, password: str, monitor_since: date) -> list[dict]:
    """Fetch all emails since monitor_since. Runs in thread executor.
    Returns list of parsed email dicts, or raises RuntimeError on connection failure.
    """
    mail = None
    try:
        mail = _connect_imap(email_addr, password)
        mail.select("INBOX", readonly=True)

        since_str = monitor_since.strftime("%d-%b-%Y")
        status, data = mail.search(None, f"(SINCE {since_str})")
        if status != "OK" or not data[0]:
            return []

        results = []
        for num in data[0].split():
            try:
                status, msg_data = mail.fetch(num, "(RFC822)")
                if status != "OK":
                    logger.error(f"Failed to fetch msg {num} from {email_addr}")
                    continue
                msg = email_lib.message_from_bytes(msg_data[0][1])

                msg_id = msg.get("Message-ID", "")
                if not msg_id:
                    msg_id = f"{msg.get('Date', '')}|{msg.get('Subject', '')}"

                subject = safe_decode_header(msg["Subject"])
                sender = safe_decode_header(msg["From"])
                recipient = safe_decode_header(msg["To"])
                body = extract_body(msg)
                raw_html, raw_text = _get_raw_parts(msg)

                try:
                    timestamp = parsedate_to_datetime(msg["Date"])
                    if timestamp.tzinfo is None:
                        timestamp = timestamp.replace(tzinfo=timezone.utc)
                except Exception:
                    timestamp = datetime.now(timezone.utc)

                results.append({
                    "msg_id": msg_id,
                    "subject": subject,
                    "sender": sender,
                    "recipient": recipient,
                    "body": body,
                    "raw_html": raw_html,
                    "raw_text": raw_text,
                    "timestamp": timestamp,
                })
            except Exception as e:
                logger.error(f"Error parsing message {num} from {email_addr}: {e}")

        return results

    except Exception as e:
        raise RuntimeError(str(e)) from e
    finally:
        if mail:
            try:
                mail.logout()
            except Exception:
                pass


# ─── Async Orchestration ─────────────────────────────────────────────

async def _check_one_mailbox(mb: MailboxConfig):
    """Check a single mailbox: fetch, classify, send, log."""
    from app.services.telegram_service import send_telegram_message

    monitor_since = mb.monitor_since or date.today()
    logger.info(f"[mail-reporter] Checking {mb.email} since {monitor_since}")

    # Fetch emails in a thread (IMAP is blocking)
    try:
        raw_emails = await asyncio.to_thread(
            _fetch_imap_emails, mb.email, mb.password, monitor_since
        )
    except RuntimeError as e:
        logger.error(f"[mail-reporter] IMAP failed for {mb.email}: {e}")
        async with AsyncSessionFactory() as db:
            row = await db.get(MailboxConfig, mb.id)
            if row:
                row.consecutive_failures += 1
                row.last_error = str(e)[:500]
                row.last_poll_at = datetime.now(timezone.utc)
                await db.commit()
        return

    sent_count = skipped_filter = skipped_dedup = 0

    async with AsyncSessionFactory() as db:
        for raw in raw_emails:
            try:
                fingerprint = _make_fingerprint(raw["msg_id"], mb.email)

                # Dedup check
                existing = await db.execute(
                    select(EmailLog).where(EmailLog.fingerprint == fingerprint)
                )
                if existing.scalar_one_or_none():
                    skipped_dedup += 1
                    continue

                # Subject filter
                subj = raw["subject"]
                if mb.subject_filter and mb.subject_filter.upper() != "NONE":
                    if mb.subject_filter.lower() not in subj.lower():
                        logger.info(
                            f"[mail-reporter] SKIP [{mb.email}] '{subj}' — filter '{mb.subject_filter}'"
                        )
                        skipped_filter += 1
                        db.add(EmailLog(
                            mailbox_id=mb.id, fingerprint=fingerprint,
                            subject=subj[:500], sender=raw["sender"][:500],
                            category="filtered", telegram_sent=False,
                            skip_reason="filter", received_at=raw["timestamp"],
                        ))
                        continue

                # Classify
                category, extra = classify_email(
                    raw["sender"], raw["subject"], raw["body"],
                    raw_html=raw["raw_html"], raw_text=raw["raw_text"],
                )

                # Format
                message = format_message(
                    category, extra, raw["sender"], raw["recipient"],
                    raw["subject"], raw["timestamp"], raw["body"], mb.email,
                )

                # Resolve Telegram target
                chat_id, thread_id = _resolve_target(mb.telegram_target)

                sent = False
                skip_reason = None
                if not chat_id:
                    logger.warning(
                        f"[mail-reporter] No Telegram target for {mb.email}, skipping send"
                    )
                    skip_reason = "no_target"
                else:
                    sent = await send_telegram_message(chat_id, message, thread_id or None)
                    if not sent:
                        skip_reason = "send_error"

                tg_target_str = f"{chat_id}:{thread_id}" if thread_id else chat_id

                log_entry = EmailLog(
                    mailbox_id=mb.id,
                    fingerprint=fingerprint,
                    subject=raw["subject"][:500],
                    sender=raw["sender"][:500],
                    category=category,
                    telegram_sent=sent,
                    telegram_target_used=tg_target_str if chat_id else None,
                    extracted_code=extra.get("code") if category == "adobe" else None,
                    skip_reason=skip_reason,
                    received_at=raw["timestamp"],
                )
                db.add(log_entry)

                if sent:
                    sent_count += 1
                    logger.info(
                        f"[mail-reporter] SENT [{category}] '{raw['subject']}' "
                        f"from {mb.email} → {tg_target_str}"
                    )

            except Exception as e:
                logger.error(f"[mail-reporter] Error processing email from {mb.email}: {e}")

        # Update mailbox status
        row = await db.get(MailboxConfig, mb.id)
        if row:
            row.last_poll_at = datetime.now(timezone.utc)
            row.last_error = None
            row.consecutive_failures = 0

        await db.commit()

    logger.info(
        f"[mail-reporter] {mb.email} — "
        f"{len(raw_emails)} fetched, {sent_count} sent, "
        f"{skipped_dedup} dedup, {skipped_filter} filtered"
    )


async def check_all_mailboxes():
    """APScheduler entry point. Check all enabled mailboxes."""
    async with AsyncSessionFactory() as db:
        result = await db.execute(
            select(MailboxConfig).where(MailboxConfig.enabled == True)
        )
        mailboxes = result.scalars().all()

    if not mailboxes:
        return

    for mb in mailboxes:
        try:
            await _check_one_mailbox(mb)
        except Exception as e:
            logger.error(f"[mail-reporter] Unhandled error for {mb.email}: {e}")
