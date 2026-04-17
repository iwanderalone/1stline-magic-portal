import email as email_lib
import re
from datetime import datetime, timezone
from email.header import decode_header
from email.utils import parsedate_to_datetime
from typing import Optional

from bs4 import BeautifulSoup

_CLEANUP_PATTERNS = [
    re.compile(r"\[image\s*:+[^\]]*\]", re.I),
    re.compile(r"\[https?://[^\]]+\]"),
    re.compile(r"<https?://[^>]+>"),
    re.compile(r"(https?://\S+)\s+\1", re.I),
    re.compile(r"^https?://\S*(?:click|track|open|pixel|unsub|beacon|redirect)\S*$", re.I | re.M),
]
_BARE_URL_LINE = re.compile(r"^https?://\S+$")


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


def _get_raw_parts(msg) -> tuple[str, str]:
    html_parts, text_parts = [], []
    if msg.is_multipart():
        for part in msg.walk():
            if "attachment" in str(part.get("Content-Disposition", "")):
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


def parse_email(msg) -> dict:
    """Parse an email.message.Message into a processing dict."""
    msg_id = msg.get("Message-ID", "")
    if not msg_id:
        msg_id = f"{msg.get('Date', '')}|{msg.get('Subject', '')}"

    try:
        timestamp = parsedate_to_datetime(msg["Date"])
        if timestamp.tzinfo is None:
            timestamp = timestamp.replace(tzinfo=timezone.utc)
    except Exception:
        timestamp = datetime.now(timezone.utc)

    raw_html, raw_text = _get_raw_parts(msg)

    return {
        "msg_id": msg_id,
        "subject": safe_decode_header(msg["Subject"]),
        "sender": safe_decode_header(msg["From"]),
        "recipient": safe_decode_header(msg["To"]),
        "body": extract_body(msg),
        "raw_html": raw_html,
        "raw_text": raw_text,
        "timestamp": timestamp,
    }
