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

Invoices are the source of truth for what was actually paid. An invoice for a
subscription never adds a second payment next to the expected one: it *settles*
the period — the `unconfirmed` row for that period becomes the confirmed one
(real amount, invoice number, file), or a new row is written and the renewal
date moves past the paid period so the job does not generate it again.
"""
import calendar
import json
import logging
import re
import uuid
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import and_, func, or_, select

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


# ─── Invoices ↔ subscriptions ────────────────────────────

# Legal-form words that differ between how we name a vendor ("Proxmox") and
# what is printed on its invoice ("Proxmox Server Solutions GmbH").
_LEGAL_FORMS = {
    "llc", "fze", "fzco", "fz", "co", "ltd", "limited", "inc", "est", "gmbh", "corp", "corporation",
    "pty", "ag", "sa", "bv", "srl", "sarl", "plc", "llp", "lp", "ooo", "company", "the",
}


def _words(text: Optional[str]) -> list[str]:
    return re.sub(r"[^a-z0-9]+", " ", (text or "").casefold()).split()


def vendor_key(name: Optional[str]) -> tuple[str, ...]:
    """'LucidLink Corp.' → ('lucidlink',); 'MICRO SPEED COMPUTERS L.L.C' → ('micro','speed','computers')."""
    return tuple(w for w in _words(name) if len(w) > 1 and w not in _LEGAL_FORMS)


def same_vendor(a: Optional[str], b: Optional[str]) -> bool:
    """Equal once legal forms are dropped, or one name is the leading words of
    the other ('Proxmox' ~ 'Proxmox Server Solutions GmbH'). Word-wise, so
    'du' never matches 'Dubai Something'."""
    ka, kb = vendor_key(a), vendor_key(b)
    if not ka or not kb:
        return False
    short, long_ = (ka, kb) if len(ka) <= len(kb) else (kb, ka)
    return long_[:len(short)] == short


def _compact(text: Optional[str]) -> str:
    return re.sub(r"[^a-z0-9]+", "", (text or "").casefold())


def match_subscriptions(subs, supplier: Optional[str], text: Optional[str], *,
                        reference: Optional[str] = None, period_start: Optional[date] = None,
                        quantity: int = 1) -> list[int]:
    """Which subscription(s) an invoice line pays for. Conservative — an empty
    answer makes a human pick, a wrong one books money on the wrong thing.

      1. a subscription's own reference (licence key, account or phone number)
         printed on the line settles it;
      2. otherwise the vendor's subscriptions, narrowed by product wording;
      3. still several identical ones (five 'VE Community 1 CPU' keys) → those
         renewing on the line's period start, if they are no more than the
         line's quantity.
    """
    haystack = _compact(f"{text or ''} {reference or ''}")
    by_ref = [s.id for s in subs if len(_compact(s.reference)) >= 5 and _compact(s.reference) in haystack]
    if by_ref:
        return by_ref

    cands = [s for s in subs if same_vendor(supplier, s.vendor) or same_vendor(supplier, s.seller)]
    if len(cands) <= 1:
        return [s.id for s in cands]

    line = set(_words(text))

    def score(s) -> float:
        product = set(_words(s.product))
        return len(product & line) / len(product) if product else 0.0

    scored = [(score(s), s) for s in cands]
    best = max(sc for sc, _ in scored)
    if best < 0.34:
        return []
    top = [s for sc, s in scored if sc >= best - 0.05]
    if len(top) == 1:
        return [top[0].id]
    if period_start:
        on_date = [s for s in top if s.next_renewal and abs((s.next_renewal - period_start).days) <= 3]
        if 1 <= len(on_date) <= max(quantity, 1):
            return [s.id for s in on_date]
    return []


def cycle_end(start: date, cycle_months: int) -> date:
    return add_months(start, cycle_months or 1) - timedelta(days=1)


def assumed_period(sub: Subscription, paid_on: date) -> tuple[Optional[date], Optional[date]]:
    """An invoice with no period printed, dated shortly before (or at) the
    renewal, pays the upcoming cycle. Anything else is left without a period
    rather than guessed — a January invoice uploaded in November must not move
    next year's renewal."""
    if not sub.next_renewal:
        return None, None
    cycle = sub.cycle_months or 1
    lead = min(45, cycle * 15)
    if -5 <= (sub.next_renewal - paid_on).days <= lead:
        return sub.next_renewal, cycle_end(sub.next_renewal, cycle)
    return None, None


def advance_past(sub: Subscription, period_end: Optional[date]) -> bool:
    """Move next_renewal beyond a paid period. Steps whole cycles to keep the
    day of month; when the invoice's own dates disagree with ours by more than
    a few days, the invoice wins."""
    if not period_end or sub.status != "active":
        return False
    after = period_end + timedelta(days=1)
    if sub.next_renewal is None:
        sub.next_renewal = after
    elif sub.next_renewal > period_end - timedelta(days=3):
        return False
    else:
        nxt = sub.next_renewal
        for _ in range(120):
            if nxt > period_end - timedelta(days=3):
                break
            nxt = add_months(nxt, sub.cycle_months or 1)
        sub.next_renewal = nxt if abs((nxt - after).days) <= 3 else after
    sub.reminded_for = None
    return True


async def find_expected(db, sub_id: int, *, period_start: Optional[date], period_end: Optional[date],
                        paid_on: date, exclude_id: Optional[int] = None,
                        include_bare: bool = True) -> Optional[PurchasePayment]:
    """The payment an invoice is the real version of.

    First the job-generated `unconfirmed` one: whose period overlaps the
    invoice's (closest start wins), or — with no period on the invoice — whose
    period contains the invoice date.

    Failing that (`include_bare`), a confirmed payment that has no invoice at
    all — typed in by hand or imported from the old tracker — for the same
    period. Stricter here: the start (or, with no period, the payment date)
    must be within 3 days, so a pro-rated top-up invoice inside a month never
    swallows that month's main payment."""
    rows = (await db.execute(
        select(PurchasePayment).where(
            PurchasePayment.subscription_id == sub_id,
            or_(PurchasePayment.status == "unconfirmed",
                and_(PurchasePayment.invoice_file.is_(None), PurchasePayment.invoice_no.is_(None))),
        )
    )).unique().scalars().all()
    rows = [r for r in rows if r.id != exclude_id]
    pending = [r for r in rows if r.status == "unconfirmed" and r.period_start]
    if period_start:
        end = period_end or period_start
        hits = [r for r in pending if r.period_start <= end and (r.period_end or r.period_start) >= period_start]
    else:
        hits = [r for r in pending if r.period_start <= paid_on <= (r.period_end or r.period_start)]
    if hits:
        return min(hits, key=lambda r: abs((r.period_start - (period_start or paid_on)).days))
    if not include_bare:
        return None
    bare = [r for r in rows if r.status != "unconfirmed" and not r.invoice_file and not r.invoice_no]
    anchor = period_start or paid_on
    near = [(abs(((r.period_start if period_start else None) or r.paid_on) - anchor).days, r) for r in bare
            if (r.period_start if period_start else r.paid_on)]
    near = [(d, r) for d, r in near if d <= 3]
    return min(near, key=lambda x: x[0])[1] if near else None


async def settle_invoice(db, sub: Subscription, *, paid_on: date, amount: float, currency: str,
                         amount_aed: float, invoice_no: Optional[str], created_by: str,
                         period_start: Optional[date] = None, period_end: Optional[date] = None,
                         description: Optional[str] = None, supplier: Optional[str] = None,
                         budget_id: Optional[int] = None, card_id: Optional[int] = None,
                         payment_method: Optional[str] = None,
                         category: Optional[str] = None) -> tuple[PurchasePayment, bool]:
    """Book an invoice against a subscription. Returns (payment, merged) —
    merged = an expected payment was confirmed instead of a new one written."""
    if period_start and not period_end:
        period_end = cycle_end(period_start, sub.cycle_months or 1)
    expected = await find_expected(db, sub.id, period_start=period_start, period_end=period_end, paid_on=paid_on)
    if expected and not period_start:
        period_start, period_end = expected.period_start, expected.period_end
    if not period_start:
        period_start, period_end = assumed_period(sub, paid_on)

    p = expected or PurchasePayment(subscription_id=sub.id, created_by=created_by)
    p.paid_on = paid_on
    p.vendor = sub.vendor
    p.description = (description or sub.product or None)
    p.category = category or sub.category
    p.budget_id = budget_id if budget_id is not None else sub.budget_id
    p.payment_method = payment_method or sub.payment_method
    p.card_id = (card_id if card_id is not None else sub.card_id) if p.payment_method == "card" else None
    p.amount, p.currency, p.amount_aed = amount, currency, amount_aed
    p.period_start, p.period_end = period_start, period_end
    p.invoice_no = invoice_no
    p.status = "confirmed"
    if expected:
        p.notes = "\n".join(filter(None, [p.notes, f"Confirmed by invoice ({created_by})"]))
    else:
        db.add(p)

    # Remember the legal name on the invoice, so the next one matches by it.
    if supplier and not sub.seller and vendor_key(supplier) != vendor_key(sub.vendor):
        sub.seller = supplier[:200]
    advance_past(sub, period_end)
    return p, bool(expected)


async def invoice_already_logged(db, supplier: Optional[str], invoice_no: Optional[str]) -> list[PurchasePayment]:
    """Payments already carrying this supplier's invoice number — a re-upload."""
    number = (invoice_no or "").strip()
    if not number:
        return []
    rows = (await db.execute(
        select(PurchasePayment).where(func.lower(PurchasePayment.invoice_no) == number.lower())
    )).unique().scalars().all()
    if not rows:
        return []
    sub_ids = {r.subscription_id for r in rows if r.subscription_id}
    sellers = {}
    if sub_ids:
        sellers = dict((await db.execute(
            select(Subscription.id, Subscription.seller).where(Subscription.id.in_(sub_ids))
        )).all())
    return [r for r in rows
            if same_vendor(supplier, r.vendor) or same_vendor(supplier, sellers.get(r.subscription_id))]


async def link_payment(db, p: PurchasePayment, sub: Subscription) -> bool:
    """Attach an existing payment to a subscription. If the job had generated an
    expected payment for the same period, that one goes — the real one stays.
    Returns True when such a twin was removed."""
    printed = p.vendor
    p.subscription_id = sub.id
    p.vendor = sub.vendor
    if p.budget_id is None:
        p.budget_id = sub.budget_id
    if p.card_id is None and p.payment_method == "card":
        p.card_id = sub.card_id
    if printed and not sub.seller and vendor_key(printed) != vendor_key(sub.vendor):
        sub.seller = printed[:200]
    if p.status != "confirmed":
        return False
    # Only a payment that carries an invoice may replace an invoice-less one.
    twin = await find_expected(db, sub.id, period_start=p.period_start, period_end=p.period_end,
                               paid_on=p.paid_on, exclude_id=p.id,
                               include_bare=bool(p.invoice_file or p.invoice_no))
    if twin:
        if not p.period_start:
            p.period_start, p.period_end = twin.period_start, twin.period_end
        await db.delete(twin)
    advance_past(sub, p.period_end)
    return bool(twin)


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
                # Any payment covering this date counts, not only one starting
                # exactly on it: vendors invoice ahead, with their own dates.
                exists = (await db.execute(
                    select(PurchasePayment.id).where(
                        PurchasePayment.subscription_id == sub.id,
                        or_(
                            PurchasePayment.period_start == sub.next_renewal,
                            and_(PurchasePayment.period_start <= sub.next_renewal,
                                 PurchasePayment.period_end >= sub.next_renewal),
                        ),
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
