"""AI mail triage — the deterministic parts around the model: what counts as a
code, what counts as a repeat, how the digest and urgent posts read, and that
a broken model answer falls back instead of dropping mail."""
import json
from datetime import datetime, timezone
from types import SimpleNamespace

import httpx
import pytest

from app.services import mail_triage as mt


@pytest.mark.parametrize("subject", [
    "Verification code", "Your temporary ChatGPT login code", "Ваш временный код входа в ChatGPT",
    "Код подтверждения", "956317 is your verification code", "Your login code is 553276",
    "Your secure link to Claude is here | 2026-11-16", "Reset your Artlist password",
    "Confirm your email to invite members to your Artlist team", "🔑 Your sign-in code",
    "CMS authentication code",
])
def test_codes_are_recognised(subject):
    assert mt.is_code(subject)


@pytest.mark.parametrize("subject", [
    "New sign-in to your Sonix account from India", "Access to Adobe Premiere Pro",
    "Revoking Access - Jay Altaf", "Critical event occurred in workspace", "S3 backups: all good",
])
def test_ordinary_mail_is_not_a_code(subject):
    assert not mt.is_code(subject)


def test_repeat_key_ignores_reply_prefixes_and_display_name():
    a = mt.thread_key('"Kaspersky" <cloud_noreply@kaspersky.com>', "Critical event")
    b = mt.thread_key("<CLOUD_NOREPLY@kaspersky.com>", "Re: FW: critical event ")
    assert a == b == ("cloud_noreply@kaspersky.com", "critical event")


def _row(i, subject, summary, topic="security", sender="<a@x.com>", skip=None):
    return SimpleNamespace(id=i, sender=sender, subject=subject, triage_summary=summary,
                           triage_topic=topic, skip_reason=skip, body=None,
                           received_at=datetime(2026, 11, 24, 8, i, tzinfo=timezone.utc), created_at=None)


def test_digest_groups_by_topic_and_counts_repeats(monkeypatch):
    monkeypatch.setattr(mt, "portal_link", lambda i: f"https://p/#mail/{i}")
    rows = [
        _row(1, "Critical event", "Троян <script> заблокирован"),
        _row(2, "Critical event", "Троян заблокирован снова", skip="repeat"),
        _row(3, "Invoice #1", "Счёт Replicate $10", topic="finance", sender="<b@y.com>"),
    ]
    [text] = mt.build_digest(rows, "24.11 10:00")
    assert "3 писем" in text
    assert text.index("Безопасность") < text.index("Финансы")
    assert "×2" in text and "повтор срочного" in text
    assert "&lt;script&gt;" in text and "<script>" not in text
    assert 'href="https://p/#mail/1"' in text


def test_long_digest_is_split_under_telegram_limit(monkeypatch):
    monkeypatch.setattr(mt, "portal_link", lambda i: "")
    rows = [_row(i % 60, f"s{i}", "x" * 200, sender=f"<{i}@x.com>") for i in range(60)]
    parts = mt.build_digest(rows, "now")
    assert len(parts) > 1 and all(len(p) <= 4096 for p in parts)


def test_urgent_post_leads_with_summary_and_action(monkeypatch):
    monkeypatch.setattr(mt, "portal_link", lambda i: f"https://p/#mail/{i}")
    log = SimpleNamespace(id=7, sender="Eugenia <e@viory.video>", subject="Computer to take home",
                          triage_summary="Просит ноутбук домой", triage_action="Выдать ноутбук",
                          body="Hi team")
    text = mt.format_urgent(log, "it-support@viory.video", "2026-11-24 10:00",
                            {"label": "📩 General", "hashtag": "#email", "include_body": True})
    lines = text.splitlines()
    assert "Нужна реакция" in lines[0]
    assert lines[1] == "<b>Просит ноутбук домой</b>" and lines[2] == "→ Выдать ноутбук"
    assert "#mail/7" in text and "Hi team" in text


class _Resp:
    def __init__(self, status, content):
        self.status_code = status
        self._content = content

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError("bad", request=None, response=None)

    def json(self):
        return {"choices": [{"message": {"content": self._content}}]}


@pytest.fixture
def model_answer(monkeypatch):
    monkeypatch.setattr(mt, "eff", lambda key, default, cast=str: {"AI_BASE_URL": "http://m/v1", "AI_MODEL": "q"}.get(key, default))

    def set_answer(status, content):
        async def post(self, url, headers=None, json=None):
            return _Resp(status, content)
        monkeypatch.setattr(httpx.AsyncClient, "post", post)
    return set_answer


async def test_classify_reads_the_model_answer(model_answer):
    model_answer(200, "```json\n" + json.dumps(
        {"verdict": "urgent", "topic": "weird", "summary": " Нужен доступ ", "action": ""}) + "\n```")
    out = await mt.classify("box", "a@b", "s", "body")
    assert out == {"verdict": "urgent", "topic": "other", "summary": "Нужен доступ", "action": None}


@pytest.mark.parametrize("status,content", [
    (503, ""), (200, "not json"), (200, json.dumps({"verdict": "maybe"})),
])
async def test_model_failure_returns_none_so_mail_still_goes_out(model_answer, status, content):
    model_answer(status, content)
    assert await mt.classify("box", "a@b", "s", "body") is None
