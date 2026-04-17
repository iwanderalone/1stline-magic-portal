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
