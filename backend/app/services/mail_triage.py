"""AI triage of incoming mail: what the team must act on now, what can wait for
the digest, what is noise.

Codes and one-time links are recognised by subject and go out at once without
the model (someone is waiting for them). Everything else is read by the
self-hosted model on the OpenAI-compatible endpoint (AI_BASE_URL) — never
Gemini: full mail content stays in-house. If the model is unreachable the
caller falls back to the old behaviour (every mail to Telegram), so a broken
model can cost noise, never a missed request.

Corrections people make in the portal (triage_feedback) are fed back into the
prompt as examples.
"""
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
from sqlalchemy import select

from app.core.config import get_settings
from app.core.dynamic_settings import eff
from app.models.models import EmailLog

logger = logging.getLogger(__name__)

VERDICTS = ("urgent", "digest", "noise")
TOPICS = ("access", "security", "finance", "services", "other")
TOPIC_LABELS = {
    "access": "Люди и доступы",
    "security": "Безопасность",
    "finance": "Финансы",
    "services": "Сервисы",
    "other": "Прочее",
}

_CODE_RE = re.compile(
    r"(verification|authentication|login|log-in|sign[- ]?in|one[- ]time|security|confirmation)\s*(code|link)"
    r"|код\w* (подтверждения|входа|доступа)|временный код"
    r"|your .*code is|\bis your .*code\b|secure link|magic link"
    r"|reset your .*password|сброс пароля"
    r"|confirm your (email|e-mail|account)|verify your (email|e-mail|account)|подтвердите (почту|адрес|email)",
    re.I,
)
_PREFIX_RE = re.compile(r"^\s*((re|fw|fwd|ответ|пересл)\s*:\s*)+", re.I)
_ADDR_RE = re.compile(r"<([^>]+)>")


def enabled() -> bool:
    s = get_settings()
    return bool(
        eff("MAIL_TRIAGE_ENABLED", s.MAIL_TRIAGE_ENABLED, cast=bool)
        and eff("AI_BASE_URL", s.AI_BASE_URL)
        and model()
    )


def model() -> str:
    s = get_settings()
    return eff("MAIL_TRIAGE_MODEL", s.MAIL_TRIAGE_MODEL) or eff("AI_MODEL", s.AI_MODEL)


def is_code(subject: str) -> bool:
    """A login code, one-time link or confirm-your-email: someone is waiting."""
    return bool(_CODE_RE.search(subject or ""))


def sender_address(sender: str) -> str:
    m = _ADDR_RE.search(sender or "")
    return (m.group(1) if m else (sender or "")).strip().lower()


def thread_key(sender: str, subject: str) -> tuple[str, str]:
    """Same sender + subject without Re:/Fwd: — what counts as a repeat."""
    return sender_address(sender), _PREFIX_RE.sub("", subject or "").strip().lower()


SYSTEM = """You triage email for a small IT support team (first line) at Viory, a video news agency in Dubai, and its sister company Ruptly.
Mailboxes:
- it-support@viory.video / it-support@ruptly.video: colleagues write here with requests; vendors' service notices also land here.
- subscriptions@viory.video: the login of many shared SaaS team accounts (Sonix, Artlist, Claude, OpenAI, Replicate, Canva...). Most mail here is automatic account notices.
- adobe@viory.video: the shared Adobe admin account.
The team works from many countries, so sign-in notifications from unusual locations on shared accounts are routine.

Decide what the team must do about each email:
- "urgent": someone must act today. A person (colleague, manager, HR, accounting, a vendor's human) asks IT for something, asks the team a question or for a confirmation, or reports a problem; a colleague forwards a suspicious or phishing email; access to grant or revoke; onboarding/offboarding; a support ticket waiting for our answer; a security alert that says a threat was NOT blocked or needs manual action, or a real account compromise; an outage or failure affecting us (failed backup, service down); payment failed, card declined, account suspended or deleted or about to be, a hard limit reached that blocks work; a deadline that expires within a few days.
- "digest": worth knowing, no action today. Invoices and receipts, upcoming renewals, terms/policy changes, a service or feature being shut down, new members joined a team account, soft usage or spend warnings, security alerts that were already blocked/remediated, a shared tool failing to process one user's own file (e.g. Sonix could not transcribe or detect the language — the user retries), replies in threads that need no answer, vendor account-manager check-ins.
- "noise": marketing, newsletters, webinars, product launches, promotions, sales outreach, routine sign-in notices, "all good" status reports, welcome emails, thank-you/closing replies, test messages, automatic confirmations of something the team did itself.
When unsure between urgent and digest, choose urgent only if missing it could hurt someone's work or security.

topic: access (people, accounts, permissions, on/offboarding, equipment for people), security, finance (invoices, payments, renewals, limits, billing), services (vendor/service notices, outages, product changes), other.
summary: one short line in Russian saying what happened, concretely (who, what, which device/account/amount).
action: in Russian, what the team should do, imperative, short; null if nothing."""

SCHEMA = {
    "type": "object",
    "properties": {
        "verdict": {"type": "string", "enum": list(VERDICTS)},
        "topic": {"type": "string", "enum": list(TOPICS)},
        "summary": {"type": "string"},
        "action": {"type": ["string", "null"]},
    },
    "required": ["verdict", "topic", "summary", "action"],
}


async def load_examples(db, limit: int = 20) -> str:
    """People's corrections, newest first, as prompt examples."""
    rows = (await db.execute(
        select(EmailLog.sender, EmailLog.subject, EmailLog.triage_feedback)
        .where(EmailLog.triage_feedback.is_not(None))
        .where((EmailLog.triage.is_(None)) | (EmailLog.triage != EmailLog.triage_feedback))
        .order_by(EmailLog.id.desc()).limit(limit)
    )).all()
    if not rows:
        return ""
    lines = [f"- From: {r.sender} | Subject: {r.subject} → {r.triage_feedback}" for r in rows]
    return ("\n\nThe team corrected these earlier decisions; follow the same judgement for similar mail:\n"
            + "\n".join(lines))


async def classify(mailbox: str, sender: str, subject: str, body: str,
                   examples: str = "") -> Optional[dict]:
    """{verdict, topic, summary, action}, or None when the model failed."""
    s = get_settings()
    url = eff("AI_BASE_URL", s.AI_BASE_URL).rstrip("/") + "/chat/completions"
    key = eff("AI_API_KEY", s.AI_API_KEY)
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    user = f"Mailbox: {mailbox}\nFrom: {sender}\nSubject: {subject}\n\n{(body or '')[:4000]}"
    payload = {
        "model": model(),
        "messages": [{"role": "system", "content": SYSTEM + examples},
                     {"role": "user", "content": user}],
        "response_format": {"type": "json_schema", "json_schema": {"name": "triage", "schema": SCHEMA}},
        "temperature": 0,
        "reasoning_effort": "none",
        "max_tokens": 400,
        "stream": False,
    }
    try:
        async with httpx.AsyncClient(timeout=90) as client:
            for attempt in range(2):
                resp = await client.post(url, headers=headers, json=payload)
                if resp.status_code not in (500, 502, 503) or attempt:
                    break
        resp.raise_for_status()
        text = (resp.json()["choices"][0]["message"].get("content") or "").strip()
        if text.startswith("```"):
            text = text.strip("`").removeprefix("json").strip()
        out = json.loads(text)
    except Exception as exc:
        logger.warning("[mail-triage] model failed for %r: %r", (subject or "")[:80], exc)
        return None
    if out.get("verdict") not in VERDICTS:
        logger.warning("[mail-triage] unexpected verdict %r", out.get("verdict"))
        return None
    return {
        "verdict": out["verdict"],
        "topic": out.get("topic") if out.get("topic") in TOPICS else "other",
        "summary": (out.get("summary") or "").strip()[:500] or None,
        "action": (out.get("action") or "").strip()[:500] or None,
    }


async def is_repeat(db, sender: str, subject: str, received_at: datetime) -> bool:
    """An urgent alert with the same sender + subject already went out recently."""
    hours = eff("MAIL_TRIAGE_REPEAT_HOURS", get_settings().MAIL_TRIAGE_REPEAT_HOURS, cast=int)
    addr, subj = thread_key(sender, subject)
    if not addr:
        return False
    since = (received_at or datetime.now(timezone.utc)) - timedelta(hours=hours)
    rows = (await db.execute(
        select(EmailLog.sender, EmailLog.subject)
        .where(EmailLog.triage == "urgent", EmailLog.telegram_sent.is_(True),
               EmailLog.received_at >= since, EmailLog.sender.ilike(f"%{addr}%"))
    )).all()
    return any(thread_key(r.sender, r.subject) == (addr, subj) for r in rows)


# ─── Telegram texts ───────────────────────────────────────────────────

def portal_link(email_id: int) -> str:
    s = get_settings()
    base = (eff("PORTAL_PUBLIC_URL", s.PORTAL_PUBLIC_URL) or (s.cors_origins_list or [""])[0]).rstrip("/")
    return f"{base}/#mail/{email_id}" if base else ""


def format_urgent(log: EmailLog, mailbox_email: str, local_time: str, display: Optional[dict]) -> str:
    from app.services.mail_reporter_service import escape_html
    label = (display or {}).get("label") or "📩"
    hashtag = (display or {}).get("hashtag") or ""
    mentions = ((display or {}).get("mention_users") or "").strip()
    link = portal_link(log.id)
    lines = [f"🔴 <b>Нужна реакция</b> · {escape_html(label)}" + (f" <b>{escape_html(hashtag)}</b>" if hashtag else "")]
    if mentions:
        lines.append(mentions)
    lines.append(f"<b>{escape_html(log.triage_summary or log.subject or '(no subject)')}</b>")
    if log.triage_action:
        lines.append(f"→ {escape_html(log.triage_action)}")
    lines += [
        "━━━━━━━━━━━━━━━━━━━━",
        f"<b>From:</b> {escape_html(log.sender or '')}",
        f"<b>Subject:</b> {escape_html(log.subject or '')}",
        f"📥 {escape_html(mailbox_email)} · 🕐 {local_time}",
    ]
    if link:
        lines.append(f'<a href="{escape_html(link)}">Открыть в портале</a>')
    if (display or {}).get("include_body", True) and log.body:
        lines.append(f"<blockquote expandable>{escape_html(log.body[:2500])}</blockquote>")
    return "\n".join(lines)


def build_digest(rows: list[EmailLog], now_local: str) -> list[str]:
    """Digest messages (split under Telegram's 4096 limit). Repeats of one
    sender + subject collapse into one line with a counter."""
    from app.services.mail_reporter_service import escape_html
    groups: dict[tuple, list[EmailLog]] = {}
    for r in sorted(rows, key=lambda r: r.received_at or r.created_at):
        groups.setdefault(thread_key(r.sender, r.subject), []).append(r)
    by_topic: dict[str, list[str]] = {}
    for items in groups.values():
        first = items[0]
        text = escape_html(first.triage_summary or first.subject or "(no subject)")
        link = portal_link(first.id)
        line = f'• <a href="{escape_html(link)}">{text}</a>' if link else f"• {text}"
        if len(items) > 1:
            line += f" <b>×{len(items)}</b>"
        if first.skip_reason == "repeat" or any(i.skip_reason == "repeat" for i in items):
            line += " <i>(повтор срочного)</i>"
        by_topic.setdefault(first.triage_topic or "other", []).append(line)

    header = f"📋 <b>Сводка почты</b> · {now_local} · {len(rows)} писем"
    blocks = []
    for topic in TOPICS:
        if topic in by_topic:
            blocks.append([f"\n<b>{TOPIC_LABELS[topic]}</b>"] + by_topic[topic])
    messages, cur = [], header
    for block in blocks:
        for line in block:
            if len(cur) + len(line) + 1 > 3900:
                messages.append(cur)
                cur = header + " (продолжение)"
            cur += "\n" + line
    messages.append(cur)
    return messages


async def send_digest():
    """Scheduled at MAIL_DIGEST_HOURS: everything triaged "digest" (and the
    urgent repeats that were held back) since the last digest, in one post."""
    from zoneinfo import ZoneInfo
    from collections import Counter
    from app.core.database import AsyncSessionFactory
    from app.models.models import MailboxConfig
    from app.services.mail_reporter_service import _resolve_target
    from app.services.telegram_service import send_telegram_message

    s = get_settings()
    if not eff("MAIL_TRIAGE_ENABLED", s.MAIL_TRIAGE_ENABLED, cast=bool):
        return
    try:
        async with AsyncSessionFactory() as db:
            since = datetime.now(timezone.utc) - timedelta(days=3)
            rows = (await db.execute(
                select(EmailLog).where(
                    EmailLog.digested_at.is_(None), EmailLog.received_at >= since,
                    (EmailLog.triage == "digest") | (EmailLog.skip_reason == "repeat"),
                )
            )).scalars().all()
            if not rows:
                return
            target = eff("MAIL_DIGEST_TARGET", s.MAIL_DIGEST_TARGET)
            if not target:
                boxes = (await db.execute(select(MailboxConfig.telegram_target)
                                          .where(MailboxConfig.enabled.is_(True)))).scalars().all()
                common = Counter(b for b in boxes if b).most_common(1)
                target = common[0][0] if common else ""
            chat_id, thread_id = _resolve_target(target)
            if not chat_id:
                logger.warning("[mail-triage] digest has no Telegram target")
                return
            tz = ZoneInfo(eff("MAIL_DIGEST_TZ", s.MAIL_DIGEST_TZ) or "UTC")
            now_local = datetime.now(tz).strftime("%d.%m %H:%M")
            ok = True
            for text in build_digest(rows, now_local):
                ok = await send_telegram_message(chat_id, text, thread_id or None) and ok
            if ok:
                stamp = datetime.now(timezone.utc)
                for r in rows:
                    r.digested_at = stamp
                await db.commit()
            logger.info("[mail-triage] digest: %d emails, sent=%s", len(rows), ok)
    except Exception:
        logger.exception("[mail-triage] digest failed")
