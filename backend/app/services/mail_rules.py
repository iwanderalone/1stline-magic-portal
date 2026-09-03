"""Condition matching for mail routing rules.

A rule carries a list of conditions, each `{field, op, value}`, combined with
ALL or ANY. Matching is substring-based by default, so a fragment of a word
matches the word — "счёт" finds "счёта", "invoic" finds "invoicing".

Both languages are handled by normalising each side the same way: NFKC (so
composed and decomposed Cyrillic compare equal), casefold (which lowercases
Cyrillic correctly, unlike str.lower for some scripts), and ё→е, because people
type the two interchangeably in Russian.
"""
from __future__ import annotations

import json
import logging
import re
import unicodedata
from typing import Iterable

logger = logging.getLogger(__name__)

FIELDS = ("subject", "body", "sender", "recipient", "any")
OPS = ("contains", "not_contains", "starts_with", "ends_with", "equals", "regex")

MAX_CONDITIONS = 20


def normalize(text: str) -> str:
    """Fold a string so RU/EN comparisons are case- and form-insensitive."""
    text = unicodedata.normalize("NFKC", text or "")
    text = text.casefold()
    return text.replace("ё", "е")   # casefold already mapped Ё → ё


def parse_conditions(raw: str | None) -> list[dict]:
    """Conditions as stored (JSON text) → validated list. Never raises."""
    if not raw:
        return []
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        logger.warning("[mail-rules] ignoring unparseable conditions JSON")
        return []
    if not isinstance(data, list):
        return []

    out: list[dict] = []
    for item in data[:MAX_CONDITIONS]:
        if not isinstance(item, dict):
            continue
        field = str(item.get("field") or "any").lower()
        op = str(item.get("op") or "contains").lower()
        value = str(item.get("value") or "")
        if field in FIELDS and op in OPS and value.strip():
            out.append({"field": field, "op": op, "value": value})
    return out


def _haystack(field: str, parts: dict[str, str]) -> str:
    if field == "any":
        return "\n".join(parts.get(k, "") for k in ("subject", "body", "sender", "recipient"))
    return parts.get(field, "")


def _test(op: str, haystack: str, needle: str, raw_needle: str) -> bool:
    if op == "regex":
        try:
            # Case-insensitive and Unicode-aware; a bad pattern never matches
            # rather than taking the poller down.
            return re.search(raw_needle, haystack, re.IGNORECASE | re.UNICODE) is not None
        except re.error:
            logger.warning("[mail-rules] invalid regex in rule condition: %r", raw_needle)
            return False
    if op == "contains":
        return needle in haystack
    if op == "not_contains":
        return needle not in haystack
    if op == "starts_with":
        return haystack.lstrip().startswith(needle)
    if op == "ends_with":
        return haystack.rstrip().endswith(needle)
    if op == "equals":
        return haystack.strip() == needle
    return False


def evaluate(conditions: Iterable[dict], mode: str, *, subject: str = "",
             body: str = "", sender: str = "", recipient: str = "") -> bool:
    """Whether the email satisfies the conditions under ALL / ANY."""
    conditions = list(conditions)
    if not conditions:
        return False

    parts = {
        "subject": normalize(subject),
        "body": normalize(body),
        "sender": normalize(sender),
        "recipient": normalize(recipient),
    }
    raw_parts = {"subject": subject or "", "body": body or "",
                 "sender": sender or "", "recipient": recipient or ""}

    results = []
    for cond in conditions:
        field, op = cond["field"], cond["op"]
        haystack = _haystack(field, parts)
        if op == "regex":
            haystack = (
                "\n".join(raw_parts.values()) if field == "any" else raw_parts.get(field, "")
            )
        results.append(_test(op, haystack, normalize(cond["value"]), cond["value"]))

    # ANY is an OR across conditions. ALL is an AND — and a not_contains
    # condition under ALL is what makes "about invoices but not receipts"
    # expressible.
    return any(results) if str(mode).lower() == "any" else all(results)
