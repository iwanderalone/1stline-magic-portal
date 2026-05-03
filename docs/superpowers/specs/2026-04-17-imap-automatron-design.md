# imap-automatron — Design Spec
_Date: 2026-04-17_

## Overview

A standalone, Dockerised IMAP-to-Telegram forwarder extracted from the 1stline-magic-portal mail reporter module. Polls one or more IMAP mailboxes on a configurable interval, classifies incoming emails against user-defined rules, and forwards formatted messages to Telegram chats/topics.

All behaviour is controlled via two files:
- `.env` — infrastructure settings (Telegram token, poll interval, timezone, log level)
- `config.json` — mailbox credentials, IMAP servers, routing rules, Telegram targets

Both files are gitignored. Committed templates (`config.example.json`, `.env.example`) contain empty strings and serve as setup guides.

---

## Project Layout

```
imap-automatron/
├── app/
│   ├── __init__.py
│   ├── main.py           # entry point: polling loop (asyncio.sleep)
│   ├── config.py         # pydantic-settings from .env
│   ├── config_loader.py  # load + validate config.json, expose typed dataclasses
│   ├── imap_client.py    # IMAP4_SSL connect, fetch, logout
│   ├── parser.py         # body extraction (multipart), HTML cleaning (BeautifulSoup)
│   ├── classifier.py     # rule-matching engine (no hardcoded rules)
│   ├── formatter.py      # build Telegram HTML message from rule display config
│   ├── telegram.py       # send_telegram_message via Bot API (httpx)
│   └── dedup.py          # SQLite fingerprint store (data/dedup.db)
├── data/                 # Docker volume — dedup.db persists here
│   └── .gitkeep
├── config.example.json   # committed — empty-string template
├── config.json           # gitignored — real credentials
├── .env.example          # committed
├── .env                  # gitignored
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── README.md
```

---

## Configuration

### `.env`

| Variable | Default | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | _(required)_ | Bot token from @BotFather |
| `POLL_INTERVAL` | `30` | Seconds between mailbox polls |
| `TIMEZONE` | `UTC` | IANA timezone for message timestamps |
| `LOG_LEVEL` | `INFO` | Python logging level |

### `config.json`

Top-level object with a `"mailboxes"` array. Each mailbox entry:

| Field | Type | Description |
|---|---|---|
| `email` | string | IMAP login address |
| `password` | string | IMAP password (app password recommended) |
| `imap_server` | string | IMAP hostname, e.g. `imap.gmail.com` |
| `imap_port` | int | Default `993` |
| `subject_filter` | string | Only process emails whose subject contains this string. Empty = no filter |
| `default_telegram_target` | string | Fallback target `"chat_id:thread_id"` or `"chat_id"` |
| `monitor_since` | string | ISO date `"YYYY-MM-DD"` — skip emails before this date |
| `rules` | array | Ordered routing rules (lowest priority number wins) |
| `catch_all` | object | Display config applied when no rule matches |

**Rule fields:**

| Field | Type | Description |
|---|---|---|
| `name` | string | Human-readable label for logs |
| `match_type` | string | `keyword` / `subject_keyword` / `sender` / `sender_domain` |
| `match_values` | array of strings | Values to match (any match wins) |
| `label` | string | Badge shown in Telegram message, e.g. `"🔴 Urgent"` |
| `hashtag` | string | Appended to message header, e.g. `"#billing"` |
| `mention_users` | string | Space-separated Telegram handles, e.g. `"@admin @support"` |
| `include_body` | bool | Whether to include cleaned email body in message |
| `telegram_target` | string | Override target for this rule; falls back to mailbox default |
| `priority` | int | Lower = matched first |

**`catch_all` fields:** `label`, `hashtag`, `mention_users`, `include_body` — no `match_*` fields needed.

### Example `config.json`

```json
{
  "mailboxes": [
    {
      "email": "support@example.com",
      "password": "",
      "imap_server": "imap.example.com",
      "imap_port": 993,
      "subject_filter": "",
      "default_telegram_target": "-100123456789:5",
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
          "telegram_target": "-100987654321",
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

---

## Component Design

### `main.py`
- Loads settings + config on startup, validates both
- Runs `asyncio` event loop with `asyncio.sleep(POLL_INTERVAL)` between cycles
- On each cycle: iterates mailboxes, calls `check_mailbox()` for each
- Handles SIGTERM/SIGINT gracefully (Docker stop)

### `config_loader.py`
- Reads `config.json` (path configurable via `CONFIG_PATH` env var, default `./config.json`)
- Validates required fields; raises clear error messages for missing/malformed entries
- Returns typed Python dataclasses (`MailboxConfig`, `RoutingRule`, `CatchAll`)

### `imap_client.py`
- `fetch_new_emails(mailbox: MailboxConfig) -> list[RawEmail]`
- Connects via `imaplib.IMAP4_SSL`, searches `SINCE monitor_since`, parses RFC822 headers
- Returns list of dicts: `{msg_id, subject, sender, recipient, body, raw_html, raw_text, timestamp}`
- Handles charset decoding, multipart walking

### `parser.py`
- `extract_body(msg)` — prefers plain text, falls back to cleaned HTML
- `clean_email_body(raw, content_type)` — strips scripts/images, deduplicates URLs, truncates at 3000 chars
- `safe_decode_header(raw)` — handles RFC2047 encoded words

### `classifier.py`
- `classify(email: RawEmail, rules: list[RoutingRule]) -> RoutingRule | CatchAll`
- Iterates rules sorted by priority; first match wins
- `match_type` dispatch: `keyword` checks subject+body, `subject_keyword` checks subject only, `sender`/`sender_domain` checks from address

### `formatter.py`
- `format_message(email, rule_or_catchall, mailbox_email, timezone) -> str`
- Builds Telegram HTML with label, hashtag, mentions, separator line, From/To/Subject/time, optional body

### `telegram.py`
- `send_message(token, chat_id, text, thread_id=None) -> bool`
- Pure function — no global state, no settings import
- Uses `httpx.AsyncClient` with 10s timeout

### `dedup.py`
- `is_seen(fingerprint) -> bool` and `mark_seen(fingerprint)`
- SQLite file at `data/dedup.db`
- Table: `seen_emails(fingerprint TEXT PRIMARY KEY, seen_at TEXT)`
- `fingerprint = SHA256(mailbox_email + ":" + msg_id)[:24]`

---

## Docker

**`Dockerfile`** — Python 3.12-slim, installs requirements, copies app, runs `python -m app.main`

**`docker-compose.yml`** — single service, mounts `./config.json:/app/config.json:ro` and `./data:/app/data`, loads `.env`

---

## Error Handling

- IMAP connection failure: logged, mailbox skipped for this cycle, retry next poll
- Telegram send failure: logged, email recorded as not-sent in dedup store (will retry on next poll cycle since it's not marked as seen)
- Missing `catch_all`: treated as "skip silently" with a warning log — user should always define one
- Malformed `config.json`: hard fail on startup with descriptive error

---

## README Sections

1. What it does
2. Prerequisites (Docker, Telegram bot token, IMAP access)
3. Quick start (clone → copy configs → fill in → `docker compose up -d`)
4. Configuration reference (all `.env` vars + all `config.json` fields)
5. Rule types with examples
6. Telegram target format (`chat_id:thread_id`)
7. Monitoring / logs (`docker compose logs -f`)
8. Updating (pull + rebuild)
