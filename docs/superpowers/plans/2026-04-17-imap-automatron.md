# imap-automatron Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the mail reporter module from 1stline-magic-portal into a standalone Dockerised IMAP-to-Telegram forwarder that is fully configured via `.env` and `config.json`.

**Architecture:** A pure asyncio polling loop (`asyncio.sleep`) with no web framework or task queue. Each poll cycle fetches emails from all configured IMAP mailboxes, classifies them against user-defined rules in `config.json`, and forwards formatted HTML messages to Telegram. SQLite in a Docker volume handles deduplication across restarts.

**Tech Stack:** Python 3.12, pydantic-settings, beautifulsoup4, httpx, sqlite3 (stdlib), imaplib (stdlib), pytest

---

## File Map

| Path | Role |
|---|---|
| `imap-automatron/app/__init__.py` | Package marker |
| `imap-automatron/app/config.py` | Env settings via pydantic-settings |
| `imap-automatron/app/config_loader.py` | Load + validate `config.json` → typed dataclasses |
| `imap-automatron/app/dedup.py` | SQLite fingerprint dedup store |
| `imap-automatron/app/parser.py` | Email body extraction, HTML cleaning, header decoding |
| `imap-automatron/app/imap_client.py` | IMAP4_SSL connect, SINCE search, RFC822 fetch |
| `imap-automatron/app/classifier.py` | Rule matching engine (keyword / subject_keyword / sender / sender_domain) |
| `imap-automatron/app/formatter.py` | Build Telegram HTML message from rule display config |
| `imap-automatron/app/telegram.py` | `send_message` (httpx async) + `parse_telegram_target` |
| `imap-automatron/app/main.py` | Poll loop, orchestration, SIGTERM handling |
| `imap-automatron/tests/__init__.py` | Test package marker |
| `imap-automatron/tests/test_config_loader.py` | Config loading + validation |
| `imap-automatron/tests/test_dedup.py` | Fingerprint store behaviour |
| `imap-automatron/tests/test_parser.py` | Body extraction + HTML cleaning |
| `imap-automatron/tests/test_classifier.py` | Rule matching logic |
| `imap-automatron/tests/test_formatter.py` | Message formatting |
| `imap-automatron/tests/test_telegram.py` | `parse_telegram_target` + mocked `send_message` |
| `imap-automatron/config.example.json` | Template with empty strings — committed |
| `imap-automatron/.env.example` | Template — committed |
| `imap-automatron/Dockerfile` | Python 3.12-slim image |
| `imap-automatron/docker-compose.yml` | Single service, volume mounts |
| `imap-automatron/requirements.txt` | Pinned dependencies |
| `imap-automatron/README.md` | Deploy + configuration guide |

---

## Task 1: Project scaffold

**Files:**
- Create: `imap-automatron/` directory tree
- Create: `imap-automatron/app/__init__.py`
- Create: `imap-automatron/tests/__init__.py`
- Create: `imap-automatron/data/.gitkeep`
- Create: `imap-automatron/.gitignore`
- Create: `imap-automatron/requirements.txt`

- [ ] **Step 1: Create directory structure**

```bash
mkdir -p imap-automatron/app imap-automatron/tests imap-automatron/data
touch imap-automatron/app/__init__.py imap-automatron/tests/__init__.py imap-automatron/data/.gitkeep
```

- [ ] **Step 2: Create `.gitignore`**

`imap-automatron/.gitignore`:
```
.env
config.json
data/dedup.db
__pycache__/
*.pyc
.pytest_cache/
*.egg-info/
dist/
.venv/
venv/
```

- [ ] **Step 3: Create `requirements.txt`**

`imap-automatron/requirements.txt`:
```
pydantic-settings==2.5.2
beautifulsoup4==4.13.3
httpx==0.27.2
pytest==8.3.5
pytest-asyncio==0.24.0
```

- [ ] **Step 4: Create Python venv and install deps**

```bash
cd imap-automatron
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Expected: all packages install without errors.

- [ ] **Step 5: Commit**

```bash
git add imap-automatron/
git commit -m "feat(imap-automatron): scaffold project structure"
```

---

## Task 2: `config.py` — environment settings

**Files:**
- Create: `imap-automatron/app/config.py`

- [ ] **Step 1: Create `config.py`**

`imap-automatron/app/config.py`:
```python
from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True)

    TELEGRAM_BOT_TOKEN: str = ""
    POLL_INTERVAL: int = 30
    TIMEZONE: str = "UTC"
    LOG_LEVEL: str = "INFO"
    CONFIG_PATH: str = "config.json"


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 2: Smoke-test in Python REPL**

```bash
cd imap-automatron
python -c "from app.config import get_settings; s = get_settings(); print(s.POLL_INTERVAL)"
```

Expected output: `30`

- [ ] **Step 3: Commit**

```bash
git add imap-automatron/app/config.py
git commit -m "feat(imap-automatron): add env settings via pydantic-settings"
```

---

## Task 3: `config_loader.py` — typed config from JSON

**Files:**
- Create: `imap-automatron/app/config_loader.py`
- Create: `imap-automatron/tests/test_config_loader.py`

- [ ] **Step 1: Write failing tests**

`imap-automatron/tests/test_config_loader.py`:
```python
import json
import pytest
import tempfile
import os
from datetime import date
from app.config_loader import load_config, MailboxConfig, RoutingRule, CatchAll


def _write_config(data: dict) -> str:
    f = tempfile.NamedTemporaryFile(mode="w", suffix=".json", delete=False)
    json.dump(data, f)
    f.close()
    return f.name


MINIMAL_CONFIG = {
    "mailboxes": [
        {
            "email": "test@example.com",
            "password": "secret",
            "imap_server": "imap.example.com",
            "default_telegram_target": "-100123:5",
            "rules": [],
            "catch_all": {"label": "📩 General", "hashtag": "#email", "mention_users": "", "include_body": True},
        }
    ]
}


def test_load_minimal_config():
    path = _write_config(MINIMAL_CONFIG)
    try:
        mailboxes = load_config(path)
        assert len(mailboxes) == 1
        mb = mailboxes[0]
        assert isinstance(mb, MailboxConfig)
        assert mb.email == "test@example.com"
        assert mb.imap_port == 993
        assert mb.monitor_since == date(2000, 1, 1)
    finally:
        os.unlink(path)


def test_rules_sorted_by_priority():
    config = {
        "mailboxes": [
            {
                **MINIMAL_CONFIG["mailboxes"][0],
                "rules": [
                    {"name": "Low", "match_type": "keyword", "match_values": ["foo"],
                     "label": "L", "hashtag": "", "mention_users": "", "include_body": True,
                     "telegram_target": "", "priority": 50},
                    {"name": "High", "match_type": "keyword", "match_values": ["bar"],
                     "label": "H", "hashtag": "", "mention_users": "", "include_body": True,
                     "telegram_target": "", "priority": 5},
                ],
            }
        ]
    }
    path = _write_config(config)
    try:
        mailboxes = load_config(path)
        rules = mailboxes[0].rules
        assert rules[0].name == "High"
        assert rules[1].name == "Low"
    finally:
        os.unlink(path)


def test_missing_required_field_raises():
    bad = {"mailboxes": [{"email": "x@x.com", "password": "pw", "imap_server": "imap.x.com"}]}
    path = _write_config(bad)
    try:
        with pytest.raises(ValueError, match="default_telegram_target"):
            load_config(path)
    finally:
        os.unlink(path)


def test_empty_mailboxes_raises():
    path = _write_config({"mailboxes": []})
    try:
        with pytest.raises(ValueError, match="at least one mailbox"):
            load_config(path)
    finally:
        os.unlink(path)


def test_catch_all_is_none_when_absent():
    config = {
        "mailboxes": [
            {**MINIMAL_CONFIG["mailboxes"][0], "catch_all": None}
        ]
    }
    path = _write_config(config)
    try:
        mailboxes = load_config(path)
        assert mailboxes[0].catch_all is None
    finally:
        os.unlink(path)
```

- [ ] **Step 2: Run tests — expect failure**

```bash
cd imap-automatron
source .venv/bin/activate
pytest tests/test_config_loader.py -v
```

Expected: `ImportError: cannot import name 'load_config' from 'app.config_loader'`

- [ ] **Step 3: Implement `config_loader.py`**

`imap-automatron/app/config_loader.py`:
```python
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
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pytest tests/test_config_loader.py -v
```

Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add imap-automatron/app/config_loader.py imap-automatron/tests/test_config_loader.py
git commit -m "feat(imap-automatron): add config_loader with typed dataclasses"
```

---

## Task 4: `dedup.py` — SQLite fingerprint store

**Files:**
- Create: `imap-automatron/app/dedup.py`
- Create: `imap-automatron/tests/test_dedup.py`

- [ ] **Step 1: Write failing tests**

`imap-automatron/tests/test_dedup.py`:
```python
import tempfile
import os
import pytest
from app.dedup import DedupStore


@pytest.fixture
def store(tmp_path):
    return DedupStore(db_path=str(tmp_path / "dedup.db"))


def test_new_fingerprint_not_seen(store):
    assert store.is_seen("abc123") is False


def test_mark_seen_makes_it_seen(store):
    store.mark_seen("abc123")
    assert store.is_seen("abc123") is True


def test_mark_seen_idempotent(store):
    store.mark_seen("abc123")
    store.mark_seen("abc123")  # should not raise
    assert store.is_seen("abc123") is True


def test_different_fingerprints_independent(store):
    store.mark_seen("aaa")
    assert store.is_seen("bbb") is False


def test_make_fingerprint_deterministic(store):
    fp1 = store.make_fingerprint("<msg@id>", "box@example.com")
    fp2 = store.make_fingerprint("<msg@id>", "box@example.com")
    assert fp1 == fp2
    assert len(fp1) == 24


def test_make_fingerprint_differs_by_mailbox(store):
    fp1 = store.make_fingerprint("<msg@id>", "a@example.com")
    fp2 = store.make_fingerprint("<msg@id>", "b@example.com")
    assert fp1 != fp2
```

- [ ] **Step 2: Run tests — expect failure**

```bash
pytest tests/test_dedup.py -v
```

Expected: `ImportError: cannot import name 'DedupStore'`

- [ ] **Step 3: Implement `dedup.py`**

`imap-automatron/app/dedup.py`:
```python
import hashlib
import sqlite3
from datetime import datetime, timezone
from pathlib import Path


class DedupStore:
    def __init__(self, db_path: str = "data/dedup.db"):
        Path(db_path).parent.mkdir(parents=True, exist_ok=True)
        self._path = db_path
        self._init_db()

    def _init_db(self) -> None:
        with sqlite3.connect(self._path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS seen_emails (
                    fingerprint TEXT PRIMARY KEY,
                    seen_at     TEXT NOT NULL
                )
            """)
            conn.commit()

    def is_seen(self, fingerprint: str) -> bool:
        with sqlite3.connect(self._path) as conn:
            row = conn.execute(
                "SELECT 1 FROM seen_emails WHERE fingerprint = ?", (fingerprint,)
            ).fetchone()
        return row is not None

    def mark_seen(self, fingerprint: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with sqlite3.connect(self._path) as conn:
            conn.execute(
                "INSERT OR IGNORE INTO seen_emails (fingerprint, seen_at) VALUES (?, ?)",
                (fingerprint, now),
            )
            conn.commit()

    def make_fingerprint(self, msg_id: str, mailbox_email: str) -> str:
        raw = f"{mailbox_email}:{msg_id}".encode()
        return hashlib.sha256(raw).hexdigest()[:24]
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pytest tests/test_dedup.py -v
```

Expected: `6 passed`

- [ ] **Step 5: Commit**

```bash
git add imap-automatron/app/dedup.py imap-automatron/tests/test_dedup.py
git commit -m "feat(imap-automatron): add SQLite dedup store"
```

---

## Task 5: `parser.py` — body extraction and HTML cleaning

**Files:**
- Create: `imap-automatron/app/parser.py`
- Create: `imap-automatron/tests/test_parser.py`

- [ ] **Step 1: Write failing tests**

`imap-automatron/tests/test_parser.py`:
```python
import email as email_lib
import pytest
from app.parser import safe_decode_header, clean_email_body, extract_body, parse_email
from datetime import timezone


def test_safe_decode_header_plain():
    assert safe_decode_header("Hello World") == "Hello World"


def test_safe_decode_header_none():
    assert safe_decode_header(None) == "Unknown"


def test_safe_decode_header_encoded():
    # RFC2047 encoded: "=?utf-8?b?SGVsbG8=?=" decodes to "Hello"
    assert safe_decode_header("=?utf-8?b?SGVsbG8=?=") == "Hello"


def test_clean_email_body_strips_html_tags():
    html = "<html><body><p>Hello <b>World</b></p></body></html>"
    result = clean_email_body(html, "text/html")
    assert "Hello" in result
    assert "World" in result
    assert "<" not in result


def test_clean_email_body_truncates_at_3000():
    long_text = "a" * 5000
    result = clean_email_body(long_text, "text/plain")
    assert len(result) <= 3100  # 3000 + truncation message
    assert "truncated" in result


def test_clean_email_body_removes_tracking_urls():
    html = "<p>Click here</p>\nhttps://click.example.com/track/abc123\nSome text"
    result = clean_email_body(html, "text/html")
    assert "click.example.com/track" not in result


def _make_email(subject="Test", sender="from@x.com", recipient="to@x.com",
                body_text="Hello plain", body_html=None) -> email_lib.message.Message:
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    if body_html:
        msg = MIMEMultipart("alternative")
        msg.attach(MIMEText(body_text, "plain"))
        msg.attach(MIMEText(body_html, "html"))
    else:
        msg = MIMEText(body_text, "plain")
    msg["Subject"] = subject
    msg["From"] = sender
    msg["To"] = recipient
    msg["Message-ID"] = "<test123@example.com>"
    msg["Date"] = "Thu, 17 Apr 2025 10:00:00 +0000"
    return msg


def test_parse_email_returns_expected_keys():
    msg = _make_email()
    result = parse_email(msg)
    for key in ("msg_id", "subject", "sender", "recipient", "body", "raw_html", "raw_text", "timestamp"):
        assert key in result, f"Missing key: {key}"


def test_parse_email_timestamp_is_timezone_aware():
    msg = _make_email()
    result = parse_email(msg)
    assert result["timestamp"].tzinfo is not None


def test_parse_email_subject():
    msg = _make_email(subject="Important Notice")
    result = parse_email(msg)
    assert result["subject"] == "Important Notice"
```

- [ ] **Step 2: Run tests — expect failure**

```bash
pytest tests/test_parser.py -v
```

Expected: `ImportError: cannot import name 'safe_decode_header'`

- [ ] **Step 3: Implement `parser.py`**

`imap-automatron/app/parser.py`:
```python
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
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pytest tests/test_parser.py -v
```

Expected: `9 passed`

- [ ] **Step 5: Commit**

```bash
git add imap-automatron/app/parser.py imap-automatron/tests/test_parser.py
git commit -m "feat(imap-automatron): add email parser and HTML body cleaner"
```

---

## Task 6: `imap_client.py` — IMAP email fetching

**Files:**
- Create: `imap-automatron/app/imap_client.py`

No unit tests for this module — it requires a live IMAP server. Integration is tested via the full polling loop in Docker.

- [ ] **Step 1: Create `imap_client.py`**

`imap-automatron/app/imap_client.py`:
```python
import imaplib
import email as email_lib
import logging
from datetime import date

from app.parser import parse_email

logger = logging.getLogger(__name__)


def fetch_emails(
    email_addr: str,
    password: str,
    imap_server: str,
    imap_port: int,
    monitor_since: date,
) -> list[dict]:
    """Connect to IMAP, search SINCE monitor_since, return parsed email dicts.

    Raises RuntimeError on connection/auth failure so the caller can log and skip.
    """
    mail = None
    try:
        mail = imaplib.IMAP4_SSL(imap_server, imap_port, timeout=30)
        mail.login(email_addr, password)
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
                    continue
                msg = email_lib.message_from_bytes(msg_data[0][1])
                results.append(parse_email(msg))
            except Exception as e:
                logger.error(f"[{email_addr}] Error parsing message {num}: {e}")

        return results

    except Exception as e:
        raise RuntimeError(str(e)) from e
    finally:
        if mail:
            try:
                mail.logout()
            except Exception:
                pass
```

- [ ] **Step 2: Commit**

```bash
git add imap-automatron/app/imap_client.py
git commit -m "feat(imap-automatron): add IMAP client"
```

---

## Task 7: `classifier.py` — rule matching engine

**Files:**
- Create: `imap-automatron/app/classifier.py`
- Create: `imap-automatron/tests/test_classifier.py`

- [ ] **Step 1: Write failing tests**

`imap-automatron/tests/test_classifier.py`:
```python
import pytest
from app.classifier import classify
from app.config_loader import RoutingRule, CatchAll


def _rule(name, match_type, match_values, priority=100, telegram_target="") -> RoutingRule:
    return RoutingRule(
        name=name, match_type=match_type, match_values=match_values,
        label=f"[{name}]", hashtag="", mention_users="", include_body=True,
        telegram_target=telegram_target, priority=priority,
    )


def test_keyword_matches_subject():
    rules = [_rule("Billing", "keyword", ["invoice"])]
    result = classify("from@x.com", "Invoice #123", "see attachment", rules)
    assert result is not None
    assert result.name == "Billing"


def test_keyword_matches_body():
    rules = [_rule("Billing", "keyword", ["payment"])]
    result = classify("from@x.com", "Hello", "Your payment is due", rules)
    assert result is not None
    assert result.name == "Billing"


def test_subject_keyword_does_not_match_body():
    rules = [_rule("SubjOnly", "subject_keyword", ["urgent"])]
    result = classify("from@x.com", "Routine update", "This is urgent", rules)
    assert result is None


def test_subject_keyword_matches_subject():
    rules = [_rule("SubjOnly", "subject_keyword", ["urgent"])]
    result = classify("from@x.com", "URGENT: server down", "body", rules)
    assert result is not None


def test_sender_match():
    rules = [_rule("VIP", "sender", ["boss@bigcorp.com"])]
    result = classify("Boss <boss@bigcorp.com>", "Hello", "body", rules)
    assert result is not None
    assert result.name == "VIP"


def test_sender_domain_match():
    rules = [_rule("Corp", "sender_domain", ["bigcorp.com"])]
    result = classify("anyone@bigcorp.com", "Subject", "body", rules)
    assert result is not None


def test_no_match_returns_none():
    rules = [_rule("Billing", "keyword", ["invoice"])]
    result = classify("from@x.com", "Hello", "How are you", rules)
    assert result is None


def test_priority_order_first_wins():
    rules = [
        _rule("High", "keyword", ["hello"], priority=5),
        _rule("Low", "keyword", ["hello"], priority=50),
    ]
    result = classify("from@x.com", "hello world", "body", rules)
    assert result.name == "High"


def test_empty_rules_returns_none():
    assert classify("from@x.com", "subject", "body", []) is None


def test_case_insensitive_matching():
    rules = [_rule("Test", "keyword", ["INVOICE"])]
    result = classify("from@x.com", "invoice pending", "body", rules)
    assert result is not None
```

- [ ] **Step 2: Run tests — expect failure**

```bash
pytest tests/test_classifier.py -v
```

Expected: `ImportError: cannot import name 'classify'`

- [ ] **Step 3: Implement `classifier.py`**

`imap-automatron/app/classifier.py`:
```python
from typing import Optional, Union
from app.config_loader import RoutingRule, CatchAll


def classify(
    sender: str,
    subject: str,
    body: str,
    rules: list[RoutingRule],
) -> Optional[RoutingRule]:
    """Return the first matching rule (sorted by priority), or None."""
    subject_l = subject.lower()
    sender_l = sender.lower()
    body_l = body.lower()

    for rule in rules:
        values = [v.strip().lower() for v in rule.match_values if v.strip()]
        if not values:
            continue

        match_type = rule.match_type.lower()
        if match_type == "keyword":
            if any(v in subject_l or v in body_l for v in values):
                return rule
        elif match_type == "subject_keyword":
            if any(v in subject_l for v in values):
                return rule
        elif match_type in ("sender", "sender_domain"):
            if any(v in sender_l for v in values):
                return rule

    return None
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pytest tests/test_classifier.py -v
```

Expected: `10 passed`

- [ ] **Step 5: Commit**

```bash
git add imap-automatron/app/classifier.py imap-automatron/tests/test_classifier.py
git commit -m "feat(imap-automatron): add classifier rule matching engine"
```

---

## Task 8: `formatter.py` — Telegram message builder

**Files:**
- Create: `imap-automatron/app/formatter.py`
- Create: `imap-automatron/tests/test_formatter.py`

- [ ] **Step 1: Write failing tests**

`imap-automatron/tests/test_formatter.py`:
```python
from datetime import datetime, timezone
import pytest
from app.formatter import format_message, escape_html
from app.config_loader import RoutingRule, CatchAll


def _email(subject="Test Subject", sender="from@x.com",
           recipient="to@x.com", body="Hello body") -> dict:
    return {
        "subject": subject, "sender": sender, "recipient": recipient,
        "body": body,
        "timestamp": datetime(2025, 4, 17, 10, 30, tzinfo=timezone.utc),
    }


def _rule(label="📩 Email", hashtag="#test", mention_users="@admin",
          include_body=True) -> RoutingRule:
    return RoutingRule(
        name="Test Rule", match_type="keyword", match_values=["x"],
        label=label, hashtag=hashtag, mention_users=mention_users,
        include_body=include_body, telegram_target="", priority=10,
    )


def test_escape_html_ampersand():
    assert escape_html("a & b") == "a &amp; b"


def test_escape_html_angle_brackets():
    assert escape_html("<script>") == "&lt;script&gt;"


def test_format_contains_subject():
    msg = format_message(_email(), _rule(), "box@x.com")
    assert "Test Subject" in msg


def test_format_contains_sender():
    msg = format_message(_email(), _rule(), "box@x.com")
    assert "from@x.com" in msg


def test_format_contains_label_and_hashtag():
    msg = format_message(_email(), _rule(label="🔴 Alert", hashtag="#alert"), "box@x.com")
    assert "🔴 Alert" in msg
    assert "#alert" in msg


def test_format_contains_mentions():
    msg = format_message(_email(), _rule(mention_users="@admin @ceo"), "box@x.com")
    assert "@admin" in msg
    assert "@ceo" in msg


def test_format_includes_body_when_true():
    msg = format_message(_email(body="Important content"), _rule(include_body=True), "box@x.com")
    assert "Important content" in msg


def test_format_excludes_body_when_false():
    msg = format_message(_email(body="Important content"), _rule(include_body=False), "box@x.com")
    assert "Important content" not in msg


def test_format_with_catchall():
    ca = CatchAll(label="📩 General", hashtag="#email", mention_users="", include_body=True)
    msg = format_message(_email(), ca, "box@x.com")
    assert "📩 General" in msg
    assert "#email" in msg


def test_format_escapes_html_in_subject():
    msg = format_message(_email(subject="<Alert> & notice"), _rule(), "box@x.com")
    assert "<Alert>" not in msg
    assert "&lt;Alert&gt;" in msg


def test_format_contains_timestamp():
    msg = format_message(_email(), _rule(), "box@x.com", timezone_str="UTC")
    assert "2025-04-17" in msg
    assert "10:30" in msg
```

- [ ] **Step 2: Run tests — expect failure**

```bash
pytest tests/test_formatter.py -v
```

Expected: `ImportError: cannot import name 'format_message'`

- [ ] **Step 3: Implement `formatter.py`**

`imap-automatron/app/formatter.py`:
```python
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
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pytest tests/test_formatter.py -v
```

Expected: `11 passed`

- [ ] **Step 5: Commit**

```bash
git add imap-automatron/app/formatter.py imap-automatron/tests/test_formatter.py
git commit -m "feat(imap-automatron): add Telegram message formatter"
```

---

## Task 9: `telegram.py` — send messages via Bot API

**Files:**
- Create: `imap-automatron/app/telegram.py`
- Create: `imap-automatron/tests/test_telegram.py`

- [ ] **Step 1: Write failing tests**

`imap-automatron/tests/test_telegram.py`:
```python
import pytest
from app.telegram import parse_telegram_target


def test_parse_chat_only():
    chat_id, thread_id = parse_telegram_target("-100123456789")
    assert chat_id == "-100123456789"
    assert thread_id is None


def test_parse_chat_and_thread():
    chat_id, thread_id = parse_telegram_target("-100123456789:5")
    assert chat_id == "-100123456789"
    assert thread_id == "5"


def test_parse_empty_thread_returns_none():
    chat_id, thread_id = parse_telegram_target("-100123456789:")
    assert thread_id is None


def test_parse_strips_whitespace():
    chat_id, thread_id = parse_telegram_target("  -100123  :  7  ")
    assert chat_id == "-100123"
    assert thread_id == "7"


def test_parse_empty_string():
    chat_id, thread_id = parse_telegram_target("")
    assert chat_id == ""
    assert thread_id is None
```

- [ ] **Step 2: Run tests — expect failure**

```bash
pytest tests/test_telegram.py -v
```

Expected: `ImportError: cannot import name 'parse_telegram_target'`

- [ ] **Step 3: Implement `telegram.py`**

`imap-automatron/app/telegram.py`:
```python
import logging
from typing import Optional

import httpx

logger = logging.getLogger(__name__)


def parse_telegram_target(target: str) -> tuple[str, Optional[str]]:
    """Split 'chat_id:thread_id' or 'chat_id' into (chat_id, thread_id | None)."""
    target = target.strip()
    if ":" in target:
        parts = target.split(":", 1)
        chat_id = parts[0].strip()
        thread_id = parts[1].strip() or None
        return chat_id, thread_id
    return target, None


async def send_message(
    token: str,
    chat_id: str,
    text: str,
    thread_id: Optional[str] = None,
) -> bool:
    """Send an HTML message to a Telegram chat. Returns True on success."""
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload: dict = {"chat_id": chat_id, "text": text, "parse_mode": "HTML"}
    if thread_id:
        payload["message_thread_id"] = int(thread_id)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(url, json=payload)
            if not resp.is_success:
                logger.error(f"Telegram send failed: HTTP {resp.status_code} — {resp.text}")
                return False
            return True
    except Exception as e:
        logger.error(f"Telegram send failed: {type(e).__name__}: {e}")
        return False
```

- [ ] **Step 4: Run tests — expect pass**

```bash
pytest tests/test_telegram.py -v
```

Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add imap-automatron/app/telegram.py imap-automatron/tests/test_telegram.py
git commit -m "feat(imap-automatron): add Telegram sender and target parser"
```

---

## Task 10: `main.py` — polling loop and orchestration

**Files:**
- Create: `imap-automatron/app/main.py`

- [ ] **Step 1: Create `main.py`**

`imap-automatron/app/main.py`:
```python
import asyncio
import logging
import signal

from app.classifier import classify
from app.config import get_settings
from app.config_loader import MailboxConfig, RoutingRule, load_config
from app.dedup import DedupStore
from app.formatter import format_message
from app.imap_client import fetch_emails
from app.telegram import parse_telegram_target, send_message

logger = logging.getLogger(__name__)


async def check_mailbox(mb: MailboxConfig, dedup: DedupStore, settings) -> None:
    logger.info(f"[{mb.email}] Polling since {mb.monitor_since}")

    try:
        emails = await asyncio.to_thread(
            fetch_emails, mb.email, mb.password, mb.imap_server, mb.imap_port, mb.monitor_since
        )
    except RuntimeError as e:
        logger.error(f"[{mb.email}] IMAP failed: {e}")
        return

    sent = skipped_dedup = skipped_filter = 0

    for email in emails:
        fingerprint = dedup.make_fingerprint(email["msg_id"], mb.email)

        if dedup.is_seen(fingerprint):
            skipped_dedup += 1
            continue

        if mb.subject_filter and mb.subject_filter.lower() not in email["subject"].lower():
            logger.debug(f"[{mb.email}] Filtered: {email['subject']!r}")
            dedup.mark_seen(fingerprint)
            skipped_filter += 1
            continue

        matched = classify(email["sender"], email["subject"], email["body"], mb.rules)
        if matched is None:
            if mb.catch_all is None:
                logger.warning(
                    f"[{mb.email}] No rule and no catch_all for: {email['subject']!r} — skipping"
                )
                dedup.mark_seen(fingerprint)
                continue
            matched = mb.catch_all

        target = (
            matched.telegram_target
            if isinstance(matched, RoutingRule) and matched.telegram_target
            else mb.default_telegram_target
        )
        chat_id, thread_id = parse_telegram_target(target)

        if not chat_id:
            logger.warning(f"[{mb.email}] No Telegram target for: {email['subject']!r}")
            dedup.mark_seen(fingerprint)
            continue

        message = format_message(email, matched, mb.email, settings.TIMEZONE)
        ok = await send_message(settings.TELEGRAM_BOT_TOKEN, chat_id, message, thread_id)

        if ok:
            dedup.mark_seen(fingerprint)
            rule_name = matched.name if isinstance(matched, RoutingRule) else "catch_all"
            logger.info(f"[{mb.email}] Sent [{rule_name}]: {email['subject']!r} → {target}")
            sent += 1
        else:
            logger.warning(f"[{mb.email}] Send failed, will retry next poll: {email['subject']!r}")

    logger.info(
        f"[{mb.email}] Done — {len(emails)} fetched, {sent} sent, "
        f"{skipped_dedup} dedup, {skipped_filter} filtered"
    )


async def run() -> None:
    settings = get_settings()

    logging.basicConfig(
        level=getattr(logging, settings.LOG_LEVEL.upper(), logging.INFO),
        format="%(asctime)s %(levelname)-8s %(name)s — %(message)s",
    )

    try:
        mailboxes = load_config(settings.CONFIG_PATH)
    except (ValueError, FileNotFoundError) as e:
        logger.critical(f"Config error: {e}")
        raise SystemExit(1)

    dedup = DedupStore()
    logger.info(
        f"imap-automatron started — {len(mailboxes)} mailbox(es), "
        f"polling every {settings.POLL_INTERVAL}s"
    )

    stop = asyncio.Event()
    loop = asyncio.get_event_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(sig, stop.set)

    while not stop.is_set():
        for mb in mailboxes:
            try:
                await check_mailbox(mb, dedup, settings)
            except Exception as e:
                logger.error(f"[{mb.email}] Unhandled error: {e}")

        try:
            await asyncio.wait_for(stop.wait(), timeout=settings.POLL_INTERVAL)
        except asyncio.TimeoutError:
            pass

    logger.info("imap-automatron stopped")


if __name__ == "__main__":
    asyncio.run(run())
```

- [ ] **Step 2: Smoke-test entrypoint loads without error**

Create a minimal `config.json` temporarily to verify startup:
```bash
cd imap-automatron
echo '{"mailboxes":[{"email":"x@x.com","password":"pw","imap_server":"imap.x.com","default_telegram_target":"-100123","rules":[],"catch_all":{"label":"📩","hashtag":"#email","mention_users":"","include_body":true}}]}' > config.json
TELEGRAM_BOT_TOKEN=test python -c "from app.main import run; print('OK')"
```

Expected output: `OK`

```bash
rm config.json
```

- [ ] **Step 3: Run full test suite**

```bash
pytest tests/ -v
```

Expected: all tests pass (`46 passed`).

- [ ] **Step 4: Commit**

```bash
git add imap-automatron/app/main.py
git commit -m "feat(imap-automatron): add polling loop and orchestration"
```

---

## Task 11: Config templates

**Files:**
- Create: `imap-automatron/config.example.json`
- Create: `imap-automatron/.env.example`

- [ ] **Step 1: Create `config.example.json`**

`imap-automatron/config.example.json`:
```json
{
  "mailboxes": [
    {
      "email": "",
      "password": "",
      "imap_server": "imap.example.com",
      "imap_port": 993,
      "subject_filter": "",
      "default_telegram_target": "",
      "monitor_since": "2024-01-01",
      "rules": [
        {
          "name": "Billing",
          "match_type": "keyword",
          "match_values": ["invoice", "payment", "billing"],
          "label": "💰 Billing",
          "hashtag": "#billing",
          "mention_users": "@admin",
          "include_body": true,
          "telegram_target": "",
          "priority": 10
        },
        {
          "name": "VIP Sender",
          "match_type": "sender",
          "match_values": ["boss@bigclient.com"],
          "label": "⭐ VIP",
          "hashtag": "#vip",
          "mention_users": "@ceo",
          "include_body": true,
          "telegram_target": "",
          "priority": 5
        }
      ],
      "catch_all": {
        "label": "📩 General",
        "hashtag": "#email",
        "mention_users": "",
        "include_body": true
      }
    }
  ]
}
```

- [ ] **Step 2: Create `.env.example`**

`imap-automatron/.env.example`:
```
# ── Required ─────────────────────────────────────────────────────────────────
# Telegram bot token from @BotFather
TELEGRAM_BOT_TOKEN=

# ── Optional ─────────────────────────────────────────────────────────────────
# Seconds between IMAP polls (default: 30)
# POLL_INTERVAL=30

# IANA timezone for message timestamps, e.g. Europe/Moscow, Asia/Dubai, UTC
# TIMEZONE=UTC

# Logging level: DEBUG, INFO, WARNING, ERROR (default: INFO)
# LOG_LEVEL=INFO

# Path to config.json inside the container (default: config.json)
# CONFIG_PATH=config.json
```

- [ ] **Step 3: Commit**

```bash
git add imap-automatron/config.example.json imap-automatron/.env.example
git commit -m "feat(imap-automatron): add config templates"
```

---

## Task 12: Docker

**Files:**
- Create: `imap-automatron/Dockerfile`
- Create: `imap-automatron/docker-compose.yml`

- [ ] **Step 1: Create `Dockerfile`**

`imap-automatron/Dockerfile`:
```dockerfile
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app/ ./app/

RUN mkdir -p data

CMD ["python", "-m", "app.main"]
```

- [ ] **Step 2: Create `docker-compose.yml`**

`imap-automatron/docker-compose.yml`:
```yaml
services:
  imap-automatron:
    build: .
    restart: unless-stopped
    volumes:
      - ./config.json:/app/config.json:ro
      - ./data:/app/data
    env_file:
      - .env
```

- [ ] **Step 3: Build the image (requires a valid `config.json`)**

```bash
cd imap-automatron
cp config.example.json config.json
# Fill in at least email/password/imap_server/default_telegram_target before running
docker build -t imap-automatron .
```

Expected: image builds successfully, ends with `CMD ["python", "-m", "app.main"]`

- [ ] **Step 4: Commit**

```bash
git add imap-automatron/Dockerfile imap-automatron/docker-compose.yml
git commit -m "feat(imap-automatron): add Dockerfile and docker-compose"
```

---

## Task 13: `README.md`

**Files:**
- Create: `imap-automatron/README.md`

- [ ] **Step 1: Create `README.md`**

`imap-automatron/README.md`:
````markdown
# imap-automatron

Polls IMAP mailboxes and forwards matching emails to Telegram chats — zero database, zero web UI, configure via files.

## What it does

1. Connects to each configured IMAP mailbox every `POLL_INTERVAL` seconds
2. Fetches emails since `monitor_since` date
3. Matches each email against your rules (keyword, subject, sender, or domain)
4. Sends a formatted HTML message to the configured Telegram chat/topic
5. Deduplicates — each email is sent exactly once, even across restarts

---

## Prerequisites

- Docker + Docker Compose
- A Telegram bot token (create via [@BotFather](https://t.me/BotFather))
- IMAP access enabled on the mailboxes you want to monitor (use app passwords, not account passwords)

---

## Quick Start

```bash
# 1. Clone the repo and enter the folder
git clone <repo-url>
cd imap-automatron

# 2. Copy the config templates
cp config.example.json config.json
cp .env.example .env

# 3. Fill in your settings
#    Edit config.json — add email, password, imap_server, default_telegram_target
#    Edit .env        — add TELEGRAM_BOT_TOKEN

# 4. Start
docker compose up -d --build

# 5. Watch logs
docker compose logs -f
```

---

## Configuration

### `.env`

| Variable | Required | Default | Description |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes | — | Bot token from @BotFather |
| `POLL_INTERVAL` | No | `30` | Seconds between mailbox polls |
| `TIMEZONE` | No | `UTC` | IANA timezone for message timestamps |
| `LOG_LEVEL` | No | `INFO` | `DEBUG` / `INFO` / `WARNING` / `ERROR` |
| `CONFIG_PATH` | No | `config.json` | Path to config file inside container |

### `config.json`

Top-level object with a `"mailboxes"` array. Each entry:

| Field | Required | Default | Description |
|---|---|---|---|
| `email` | Yes | — | IMAP account address |
| `password` | Yes | — | IMAP password (use app password) |
| `imap_server` | Yes | — | IMAP hostname, e.g. `imap.gmail.com` |
| `imap_port` | No | `993` | IMAP port (SSL) |
| `subject_filter` | No | `""` | Only process emails whose subject contains this string |
| `default_telegram_target` | Yes | — | Fallback Telegram target (see format below) |
| `monitor_since` | No | `"2000-01-01"` | Skip emails before this date (`YYYY-MM-DD`) |
| `rules` | No | `[]` | Ordered routing rules |
| `catch_all` | No | `null` | Display config for unmatched emails |

---

## Rule Types

Each rule in `rules` has:

| Field | Description |
|---|---|
| `name` | Human-readable label for logs |
| `match_type` | `keyword`, `subject_keyword`, `sender`, or `sender_domain` |
| `match_values` | Array of strings — any match wins |
| `label` | Badge shown in message, e.g. `"🔴 Urgent"` |
| `hashtag` | Appended to header, e.g. `"#billing"` |
| `mention_users` | Telegram handles, e.g. `"@admin @support"` |
| `include_body` | `true` to include cleaned email body in message |
| `telegram_target` | Override target for this rule; falls back to mailbox default |
| `priority` | Integer — lower number = matched first |

**`match_type` reference:**

| Type | Matches against |
|---|---|
| `keyword` | Subject **or** body |
| `subject_keyword` | Subject only |
| `sender` | Full sender address |
| `sender_domain` | Sender address (domain suffix match) |

Matching is case-insensitive. First matching rule wins. If no rule matches and `catch_all` is defined, it is used. If neither matches, the email is skipped with a warning log.

---

## Telegram Target Format

```
"chat_id"           → sends to chat, no topic
"chat_id:thread_id" → sends to a specific forum topic
```

Examples:
```
"-100123456789"       → group chat
"-100123456789:5"     → thread 5 inside that group
```

To get a chat ID: add [@userinfobot](https://t.me/userinfobot) to your group, or forward a message to it.

---

## Multiple Mailboxes

Add more entries to `"mailboxes"`:

```json
{
  "mailboxes": [
    { "email": "support@company.com", ... },
    { "email": "billing@company.com", ... }
  ]
}
```

Each mailbox has its own rules and Telegram targets.

---

## Updating

```bash
git pull
docker compose up -d --build
```

## Monitoring

```bash
# Live logs
docker compose logs -f

# Check dedup database size
ls -lh data/dedup.db
```

## Stopping

```bash
docker compose down
```

Dedup state is preserved in `data/dedup.db` — emails already sent will not be re-sent when you restart.
````

- [ ] **Step 2: Commit**

```bash
git add imap-automatron/README.md
git commit -m "docs(imap-automatron): add deploy and configuration README"
```

---

## Final: Run full test suite

- [ ] **Run all tests from the project root**

```bash
cd imap-automatron
pytest tests/ -v
```

Expected: all tests pass with no warnings.

- [ ] **Verify Docker build is clean**

```bash
docker build -t imap-automatron . 2>&1 | tail -5
```

Expected: `Successfully built ...` or `=> exporting to image` (BuildKit output).
