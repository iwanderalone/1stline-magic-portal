import os

import pytest

os.environ.setdefault("SECRET_KEY", "a" * 32)
os.environ.setdefault("JWT_SECRET", "b" * 64)

from app.services.mail_rules import evaluate, parse_conditions  # noqa: E402


def cond(field, op, value):
    return {"field": field, "op": op, "value": value}


# ─── partial words ───────────────────────────────────────────────────

def test_fragment_matches_the_whole_word():
    """"invoic" has to find "invoicing" — people type stems, not full words."""
    assert evaluate([cond("subject", "contains", "invoic")], "all",
                    subject="Your invoicing period has ended")


def test_russian_stem_matches_an_inflected_form():
    assert evaluate([cond("subject", "contains", "счет")], "all",
                    subject="Оплата счёта за сентябрь")


# ─── case and script folding ─────────────────────────────────────────

@pytest.mark.parametrize("needle,haystack", [
    ("PAYMENT", "Payment received"),
    ("payment", "PAYMENT RECEIVED"),
    ("оплата", "ОПЛАТА ПРИНЯТА"),
    ("ОПЛАТА", "оплата принята"),
])
def test_case_is_ignored_in_both_scripts(needle, haystack):
    assert evaluate([cond("subject", "contains", needle)], "all", subject=haystack)


def test_yo_and_ye_are_interchangeable():
    """Russians type ё as е constantly; a rule must not care which was used."""
    assert evaluate([cond("body", "contains", "ещё")], "all", body="а еще можно скачать")
    assert evaluate([cond("body", "contains", "еще")], "all", body="а ещё можно скачать")


# ─── fields ──────────────────────────────────────────────────────────

def test_body_condition_ignores_the_subject():
    assert not evaluate([cond("body", "contains", "urgent")], "all",
                        subject="urgent", body="nothing to see")


def test_any_searches_every_field():
    assert evaluate([cond("any", "contains", "yandex")], "all",
                    sender="noreply@messenger.yandex.ru", subject="Hi", body="Hello")


def test_recipient_is_matchable():
    assert evaluate([cond("recipient", "contains", "it-support")], "all",
                    recipient="it-support@ruptly.video")


# ─── operators and combination ───────────────────────────────────────

def test_all_requires_every_condition():
    conditions = [cond("subject", "contains", "счёт"), cond("body", "contains", "оплат")]
    assert evaluate(conditions, "all", subject="Счёт №12", body="Просим оплатить")
    assert not evaluate(conditions, "all", subject="Счёт №12", body="ничего")


def test_any_requires_only_one():
    conditions = [cond("subject", "contains", "invoice"), cond("subject", "contains", "счёт")]
    assert evaluate(conditions, "any", subject="Счёт №12")


def test_not_contains_excludes():
    """"about invoices but not receipts" — the reason ALL + not_contains exists."""
    conditions = [cond("subject", "contains", "invoice"), cond("subject", "not_contains", "receipt")]
    assert evaluate(conditions, "all", subject="Invoice 44")
    assert not evaluate(conditions, "all", subject="Invoice 44 receipt")


def test_starts_and_ends_ignore_surrounding_space():
    assert evaluate([cond("subject", "starts_with", "re:")], "all", subject="  Re: your ticket")
    assert evaluate([cond("subject", "ends_with", "failed")], "all", subject="Backup failed  ")


def test_regex_is_case_insensitive_and_unicode_aware():
    assert evaluate([cond("subject", "regex", r"счёт\s*№\s*\d+")], "all", subject="СЧЁТ № 4471")


def test_a_broken_regex_never_matches_instead_of_raising():
    assert evaluate([cond("subject", "regex", "[unclosed")], "all", subject="anything") is False


# ─── stored form ─────────────────────────────────────────────────────

def test_parse_drops_unknown_fields_and_empty_values():
    raw = '[{"field":"subject","op":"contains","value":"a"},' \
          '{"field":"nope","op":"contains","value":"b"},' \
          '{"field":"body","op":"contains","value":"  "}]'
    assert parse_conditions(raw) == [{"field": "subject", "op": "contains", "value": "a"}]


def test_parse_survives_garbage():
    assert parse_conditions("not json") == []
    assert parse_conditions(None) == []
    assert parse_conditions('{"not": "a list"}') == []


def test_no_conditions_never_matches():
    """An empty rule must not silently capture every email."""
    assert evaluate([], "all", subject="anything") is False
