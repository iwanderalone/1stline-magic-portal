import pytest
from app.classifier import classify
from app.config_loader import RoutingRule


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


def test_sender_domain_does_not_match_spoofed_domain():
    rules = [_rule("Corp", "sender_domain", ["bigcorp.com"])]
    result = classify("anyone@fakebigcorp.com", "Subject", "body", rules)
    assert result is None


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
