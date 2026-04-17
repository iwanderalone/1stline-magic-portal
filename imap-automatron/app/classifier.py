from typing import Optional
from app.config_loader import RoutingRule


def classify(
    sender: str,
    subject: str,
    body: str,
    rules: list[RoutingRule],
) -> Optional[RoutingRule]:
    """Return the first matching rule (sorted by priority), or None."""
    subject_l = subject.lower()
    sender_l = sender.lower()
    body_l = body.lower()

    for rule in rules:
        values = [v.strip().lower() for v in rule.match_values if v.strip()]
        if not values:
            continue

        match_type = rule.match_type.lower()
        if match_type == "keyword":
            if any(v in subject_l or v in body_l for v in values):
                return rule
        elif match_type == "subject_keyword":
            if any(v in subject_l for v in values):
                return rule
        elif match_type == "sender":
            if any(v in sender_l for v in values):
                return rule
        elif match_type == "sender_domain":
            if any("@" + v in sender_l for v in values):
                return rule

    return None
