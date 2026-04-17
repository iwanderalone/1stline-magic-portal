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
