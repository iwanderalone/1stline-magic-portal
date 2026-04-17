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
