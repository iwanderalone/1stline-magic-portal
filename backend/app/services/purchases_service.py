"""Subscriptions & Purchases — money math and the daily renewal job.

Money model: every amount is kept in the vendor's currency AND in AED, because
the office pays in AED and the bank converts at its own rate. USD is never
stored — AED is pegged to USD at a fixed 3.6725, so it is derived on the fly.
Other currencies use the admin-tunable PURCHASES_FX_TO_AED table, which only
has to be good enough for *expected* amounts; confirmed payments carry the real
AED figure from the statement.

The renewal job (hourly, idempotent):
  * a subscription whose next_renewal has passed gets an `unconfirmed` payment
    for that period and its next_renewal moves one cycle forward — a human
    later confirms it with the real AED amount;
  * a non-auto-renewing one is left alone (it shows as lapsed instead);
  * owners are reminded N days before a renewal (Telegram DM if linked + bell).
"""
import calendar
import json
import logging
import uuid
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import select

from app.core.config import get_settings
from app.core.database import AsyncSessionFactory
from app.core.dynamic_settings import eff
from app.models.models import (
    Notification, PurchasePayment, Subscription, User, UserRole, utcnow,
)

logger = logging.getLogger(__name__)

AED_PER_USD = 3.6725

CATEGORIES = ["software", "cloud", "isp", "telecom", "security", "hardware", "services", "other"]
PAYMENT_METHODS = ["card", "bank_transfer", "paypal", "other"]
CURRENCIES = ["AED", "USD", "EUR", "GBP", "RUB"]

# Catch-up cap: a subscription imported with a renewal date far in the past
# must not spawn years of phantom payments in one run.
_MAX_CATCHUP_PERIODS = 3


# ─── Currency ────────────────────────────────────────────

def fx_table() -> dict[str, float]:
    """Currency → AED rate. USD is the peg; the rest come from settings.
    A malformed entry is skipped rather than breaking every money read."""
    rates = {"AED": 1.0, "USD": AED_PER_USD}
    raw = eff("PURCHASES_FX_TO_AED", get_settings().PURCHASES_FX_TO_AED) or ""
    for part in raw.split(","):
        code, _, value = part.partition("=")
        code = code.strip().upper()
        try:
            rate = float(value)
        except ValueError:
            continue
        if len(code) == 3 and rate > 0 and code not in ("AED", "USD"):
            rates[code] = rate
    return rates


def to_aed(amount: float, currency: str) -> Optional[float]:
    """None when the currency has no known rate — the caller must not guess."""
    rate = fx_table().get((currency or "AED").upper())
    return None if rate is None else round(amount * rate, 2)


def aed_to_usd(amount_aed: Optional[float]) -> Optional[float]:
    return None if amount_aed is None else round(amount_aed / AED_PER_USD, 2)


# ─── Cycles ──────────────────────────────────────────────

def add_months(d: date, months: int) -> date:
    """Calendar-month step that clamps to month end (Jan 31 + 1 → Feb 28/29)."""
    month_index = d.month - 1 + months
    year, month = d.year + month_index // 12, month_index % 12 + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def monthly_aed(sub: Subscription) -> Optional[float]:
    """Run-rate: what this subscription costs per month, in AED."""
    aed = to_aed(sub.price or 0, sub.currency)
    if aed is None:
        return None
    return round(aed / max(sub.cycle_months or 1, 1), 2)


def remind_days(sub: Subscription) -> int:
    if sub.notify_days_before is not None:
        return sub.notify_days_before
    s = get_settings()
    if (sub.cycle_months or 1) >= 12:
        return eff("PURCHASES_REMIND_DAYS_YEARLY", s.PURCHASES_REMIND_DAYS_YEARLY, cast=int)
    return eff("PURCHASES_REMIND_DAYS_MONTHLY", s.PURCHASES_REMIND_DAYS_MONTHLY, cast=int)


def is_lapsed(sub: Subscription, today: Optional[date] = None) -> bool:
    """Active, not auto-renewing, and its renewal date is behind us."""
    today = today or date.today()
    return (sub.status == "active" and not sub.auto_renew
            and sub.next_renewal is not None and sub.next_renewal < today)


def owner_ids(sub: Subscription) -> list[str]:
    try:
        ids = json.loads(sub.owner_user_ids or "[]") or []
    except (TypeError, ValueError):
        return []
    out = []
    for x in ids:
        try:
            out.append(str(uuid.UUID(str(x))))
        except ValueError:
            continue
    return out


def payment_from_subscription(sub: Subscription, period_start: date, *,
                              status: str, created_by: str) -> PurchasePayment:
    expected_aed = to_aed(sub.price or 0, sub.currency)
    return PurchasePayment(
        subscription_id=sub.id,
        paid_on=period_start,
        vendor=sub.vendor,
        description=sub.product,
        category=sub.category,
        budget_id=sub.budget_id,
        payment_method=sub.payment_method,
        card_id=sub.card_id,
        amount=sub.price or 0,
        currency=sub.currency,
        # Unknown currency → 0 AED, flagged by the unconfirmed status; the
        # confirmer types in the real number from the statement anyway.
        amount_aed=expected_aed if expected_aed is not None else 0,
        period_start=period_start,
        period_end=add_months(period_start, sub.cycle_months or 1) - timedelta(days=1),
        status=status,
        created_by=created_by,
    )


# ─── Daily job ───────────────────────────────────────────

async def _recipients(db, sub: Subscription) -> list[User]:
    ids = owner_ids(sub)
    if ids:
        q = select(User).where(User.id.in_([uuid.UUID(i) for i in ids]), User.is_active.is_(True))
    else:
        # Nobody named → the people who can see this section at all.
        q = select(User).where(User.role.in_([UserRole.ADMIN, UserRole.MANAGER]), User.is_active.is_(True))
    return list((await db.execute(q)).scalars().all())


def _reminder_text(sub: Subscription, days_left: int) -> str:
    from app.services.mail_reporter_service import escape_html
    price = f"{sub.price:,.2f} {sub.currency}"
    when = "today" if days_left <= 0 else f"in {days_left} day{'s' if days_left != 1 else ''}"
    renew = "renews" if sub.auto_renew else "EXPIRES (no auto-renew)"
    lines = [
        f"💳 <b>{escape_html(sub.vendor)}</b>{' — ' + escape_html(sub.product) if sub.product else ''}",
        f"{renew} {when}, {sub.next_renewal:%d %b %Y}",
        f"{price}",
    ]
    if sub.card:
        lines.append(f"Card: {escape_html(sub.card.label)}{' ••' + sub.card.last4 if sub.card.last4 else ''}")
    return "\n".join(lines)


async def run_renewals(today: Optional[date] = None) -> dict:
    """Advance passed renewals and send due reminders. Safe to run repeatedly."""
    from app.services.telegram_service import send_telegram_message

    today = today or date.today()
    generated = reminded = 0
    async with AsyncSessionFactory() as db:
        subs = (await db.execute(
            select(Subscription).where(Subscription.status == "active", Subscription.next_renewal.is_not(None))
        )).unique().scalars().all()

        for sub in subs:
            # 1. Renewal passed → log the expected payment, roll forward.
            periods = 0
            while sub.auto_renew and sub.next_renewal <= today and periods < _MAX_CATCHUP_PERIODS:
                exists = (await db.execute(
                    select(PurchasePayment.id).where(
                        PurchasePayment.subscription_id == sub.id,
                        PurchasePayment.period_start == sub.next_renewal,
                    )
                )).first()
                if not exists:
                    db.add(payment_from_subscription(sub, sub.next_renewal, status="unconfirmed", created_by="system"))
                    generated += 1
                sub.next_renewal = add_months(sub.next_renewal, sub.cycle_months or 1)
                periods += 1

            # 2. Reminder, once per renewal date.
            days_left = (sub.next_renewal - today).days
            if 0 <= days_left <= remind_days(sub) and sub.reminded_for != sub.next_renewal:
                text = _reminder_text(sub, days_left)
                for user in await _recipients(db, sub):
                    db.add(Notification(
                        user_id=user.id,
                        title=f"Renewal: {sub.vendor}",
                        message=f"{sub.product or sub.vendor} — {sub.next_renewal:%d %b %Y}, {sub.price:,.2f} {sub.currency}",
                    ))
                    if user.telegram_chat_id:
                        try:
                            await send_telegram_message(user.telegram_chat_id, text, None)
                        except Exception:  # one bad chat must not stop the run
                            logger.warning("[purchases] reminder DM to %s failed", user.username, exc_info=True)
                sub.reminded_for = sub.next_renewal
                reminded += 1

        await db.commit()
    if generated or reminded:
        logger.info("[purchases] renewals: %d payments generated, %d reminders sent", generated, reminded)
    return {"generated": generated, "reminded": reminded}
