# imap-automatron

Polls IMAP mailboxes and forwards matching emails to Telegram chats — no web UI, configure via files.

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
