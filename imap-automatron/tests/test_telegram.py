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
