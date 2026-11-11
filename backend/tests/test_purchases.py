"""Subscriptions & Purchases — money math, cycle stepping and the xlsx report.
DB-free: the pieces that decide numbers people put in front of finance."""
import io
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from openpyxl import load_workbook
from pydantic import ValidationError

from app.services import purchases_service as ps


@pytest.fixture
def fx(monkeypatch):
    def set_table(raw):
        monkeypatch.setattr(ps, "eff", lambda key, default, cast=str: raw if key == "PURCHASES_FX_TO_AED" else default)
    return set_table


def test_usd_is_the_peg_and_cannot_be_overridden(fx):
    fx("USD=1,EUR=4")
    assert ps.to_aed(100, "USD") == 367.25
    assert ps.aed_to_usd(367.25) == 100.0
    assert ps.to_aed(10, "eur") == 40.0


def test_unknown_or_malformed_rate_is_none_not_a_guess(fx):
    fx("EUR=abc,RUB=0.044,XX=3")
    assert ps.to_aed(100, "EUR") is None
    assert ps.to_aed(100, "RUB") == 4.4
    assert ps.to_aed(100, "JPY") is None


@pytest.mark.parametrize("start,months,expected", [
    (date(2026, 1, 31), 1, date(2026, 2, 28)),
    (date(2028, 1, 31), 1, date(2028, 2, 29)),
    (date(2026, 11, 15), 3, date(2027, 2, 15)),
    (date(2026, 10, 15), 12, date(2027, 10, 15)),
    (date(2026, 3, 1), -11, date(2025, 4, 1)),
])
def test_add_months_clamps_to_month_end(start, months, expected):
    assert ps.add_months(start, months) == expected


def _sub(**kw):
    base = dict(id=1, vendor="Adobe", product="CC", category="software", seller=None, owner_user_ids=None,
                budget=None, budget_id=None, account_email=None, payment_method="card", card=None, card_id=None,
                cycle_months=1, price=100.0, currency="AED", seats_total=None, seats=[], next_renewal=None,
                auto_renew=True, status="active", notify_days_before=None, reference=None, notes=None)
    base.update(kw)
    return SimpleNamespace(**base)


def test_monthly_run_rate_spreads_yearly_price(fx):
    fx("")
    assert ps.monthly_aed(_sub(price=1200, cycle_months=12)) == 100.0
    assert ps.monthly_aed(_sub(price=100, currency="USD")) == 367.25


def test_lapsed_only_when_not_auto_renewing():
    past = date.today() - timedelta(days=1)
    assert ps.is_lapsed(_sub(auto_renew=False, next_renewal=past))
    assert not ps.is_lapsed(_sub(auto_renew=True, next_renewal=past))
    assert not ps.is_lapsed(_sub(auto_renew=False, next_renewal=past, status="cancelled"))


def test_owner_ids_skip_garbage():
    good = "7b1e4b1c-6c2f-4c1e-9a7e-2f0c1d2e3f40"
    assert ps.owner_ids(_sub(owner_user_ids=f'["{good}", "nope"]')) == [good]
    assert ps.owner_ids(_sub(owner_user_ids="not json")) == []


def test_generated_payment_covers_one_cycle(fx):
    fx("")
    p = ps.payment_from_subscription(_sub(price=2346, cycle_months=12), date(2027, 1, 16),
                                     status="unconfirmed", created_by="system")
    assert (p.period_start, p.period_end) == (date(2027, 1, 16), date(2028, 1, 15))
    assert p.amount_aed == 2346 and p.status == "unconfirmed"


def test_card_last4_rejects_anything_but_four_digits():
    from app.schemas.schemas import PaymentCardIn
    assert PaymentCardIn(label="Corp Visa", last4="4821").last4 == "4821"
    assert PaymentCardIn(label="Corp Visa", last4="").last4 is None
    for bad in ("4111111111111111", "48a1", "482"):
        with pytest.raises(ValidationError):
            PaymentCardIn(label="Corp Visa", last4=bad)


def test_report_has_every_sheet_and_flags_leavers(fx):
    fx("")
    from app.services.purchases_report import build_report

    seat = SimpleNamespace(netbox_contact_id=42, person_name="Jane Doe", person_department="Newsroom",
                           login=None, person_email="jane@example.com", assigned_on=date(2026, 1, 5), notes=None)
    sub = _sub(seats=[seat], seats_total=12, next_renewal=date.today() + timedelta(days=10))
    pay = SimpleNamespace(paid_on=date(2026, 5, 3), vendor="Adobe", description="CC", category="software",
                          budget=None, payment_method="card", card=None, amount=100.0, currency="AED",
                          amount_aed=100.0, period_start=None, period_end=None, invoice_no=None,
                          status="unconfirmed", notes=None)
    wb = load_workbook(io.BytesIO(build_report([sub], [pay], {}, date(2026, 1, 1), date(2026, 12, 31), {42})))
    assert wb.sheetnames == ["Summary", "Payments", "Subscriptions", "Seats"]
    assert wb["Seats"]["G2"].value == "LEFT — revoke"
    assert wb["Subscriptions"]["W2"].value == "≤30d"
    assert wb["Payments"]["K2"].value == 100.0
    assert wb["Payments"]["K3"].value == "=SUM(K2:K2)"


def test_leaver_detection_matches_both_sync_markers():
    from app.services.netbox_service import is_offboarded
    assert is_offboarded({"name": "[Disabled] Jane Doe"})
    assert is_offboarded({"name": "Jane Doe", "comments": "Disabled or removed from AD."})
    assert not is_offboarded({"name": "Jane Doe", "comments": "Moved to EU office"})


# ─── Invoices ↔ subscriptions ────────────────────────────

@pytest.mark.parametrize("a,b,same", [
    ("Proxmox", "Proxmox Server Solutions GmbH", True),
    ("LucidLink", "LucidLink Corp.", True),
    ("Canva", "Canva Pty. Ltd.", True),
    ("micro speed computers", "MICRO SPEED COMPUTERS L.L.C", True),
    ("du", "Dubai Internet City", False),
    ("Zoom", "Zoho Corporation", False),
    ("", "Proxmox", False),
])
def test_same_vendor_ignores_legal_forms_but_not_words(a, b, same):
    assert ps.same_vendor(a, b) is same


def _proxmox():
    one = "Proxmox VE Community Subscription 1 CPU/year"
    two = "Proxmox VE Community Subscription 2 CPUs/year"
    return [
        _sub(id=1, vendor="Proxmox", product=one, reference="pve1c-8c9b97c796", next_renewal=date(2027, 2, 3)),
        _sub(id=2, vendor="Proxmox", product=one, reference="pve1c-afa9ad89bf", next_renewal=date(2027, 2, 3)),
        _sub(id=3, vendor="Proxmox", product=one, reference="pve1c-81aff036cb", next_renewal=date(2027, 10, 14)),
        _sub(id=4, vendor="Proxmox", product=two, reference="pve2c-90748b1429", next_renewal=date(2027, 10, 15)),
        _sub(id=5, vendor="LucidLink", product="Filespace", reference=None, next_renewal=date(2026, 12, 3)),
        _sub(id=6, vendor="Etisalat", product="IT phone SIM", reference="0502454607", seller="Emirates Telecommunications"),
    ]


def test_licence_key_on_the_line_settles_the_match():
    line = "Proxmox VE Community Subscription 1 CPU/year - pve1c-81aff036cb (14/10/2026 - 13/10/2027)"
    assert ps.match_subscriptions(_proxmox(), "Proxmox Server Solutions GmbH", line) == [3]


def test_identical_subscriptions_are_told_apart_by_renewal_date_or_not_at_all():
    subs = _proxmox()
    line = "2 x Proxmox VE Community Subscription 1 CPU/year"
    supplier = "Proxmox Server Solutions GmbH"
    # three identical 1-CPU keys, no key printed: nothing to go on
    assert ps.match_subscriptions(subs, supplier, line, quantity=2) == []
    # the period start names the two renewing that day
    assert ps.match_subscriptions(subs, supplier, line, period_start=date(2027, 2, 3), quantity=2) == [1, 2]
    # ...but two candidates for a single unit is still a guess
    assert ps.match_subscriptions(subs, supplier, line, period_start=date(2027, 2, 3), quantity=1) == []
    # product wording separates 1 CPU from 2 CPUs
    assert ps.match_subscriptions(subs, supplier, "Proxmox VE Community Subscription 2 CPUs/year") == [4]


def test_single_vendor_subscription_and_seller_name_match():
    subs = _proxmox()
    assert ps.match_subscriptions(subs, "LucidLink Corp.", "True-up high-performance storage (per GB)") == [5]
    assert ps.match_subscriptions(subs, "Emirates Telecommunications Group", "Mobile plan") == [6]
    assert ps.match_subscriptions(subs, "Some Reseller LLC", "Mobile plan 050-245-4607") == [6]
    assert ps.match_subscriptions(subs, "Adobe Systems", "Creative Cloud") == []


def test_paid_period_moves_the_renewal_and_the_invoice_dates_win():
    # monthly, job has not run yet: one cycle forward, day of month kept
    s = _sub(next_renewal=date(2026, 11, 3), reminded_for=date(2026, 11, 3))
    assert ps.advance_past(s, date(2026, 12, 2)) is True
    assert (s.next_renewal, s.reminded_for) == (date(2026, 12, 3), None)
    # already past the paid period (historic invoice): untouched
    s = _sub(next_renewal=date(2026, 12, 3))
    assert ps.advance_past(s, date(2026, 6, 2)) is False and s.next_renewal == date(2026, 12, 3)
    # vendor prints "03/02/2026 - 03/02/2027": still 3 Feb, not 4 Feb
    s = _sub(cycle_months=12, next_renewal=date(2026, 2, 3), reminded_for=None)
    ps.advance_past(s, date(2027, 2, 3))
    assert s.next_renewal == date(2027, 2, 3)
    # our date was wrong (16 Jan) and the invoice says the period ends 14 Oct: the invoice wins
    s = _sub(cycle_months=12, next_renewal=date(2026, 1, 16), reminded_for=None)
    ps.advance_past(s, date(2027, 10, 14))
    assert s.next_renewal == date(2027, 10, 15)
    # no date at all yet
    s = _sub(next_renewal=None, reminded_for=None)
    ps.advance_past(s, date(2027, 9, 26))
    assert s.next_renewal == date(2027, 9, 27)


def test_period_is_assumed_only_for_an_invoice_near_the_renewal():
    yearly = _sub(cycle_months=12, next_renewal=date(2027, 10, 15))
    assert ps.assumed_period(yearly, date(2027, 9, 15)) == (date(2027, 10, 15), date(2028, 10, 14))
    assert ps.assumed_period(yearly, date(2026, 9, 15)) == (None, None)       # last year's invoice
    monthly = _sub(cycle_months=1, next_renewal=date(2026, 12, 3))
    assert ps.assumed_period(monthly, date(2026, 12, 3)) == (date(2026, 12, 3), date(2027, 1, 2))
    assert ps.assumed_period(monthly, date(2026, 11, 3)) == (None, None)      # that is November's


def test_split_amounts_cannot_exceed_the_invoice_total():
    from app.schemas.schemas import IntakePayment
    ok = IntakePayment(paid_on=date(2026, 6, 30), amount=1040, currency="EUR",
                       splits=[{"subscription_id": 1, "amount": 560}, {"subscription_id": 2, "amount": 480}])
    assert len(ok.splits) == 2
    with pytest.raises(ValidationError):
        IntakePayment(paid_on=date(2026, 6, 30), amount=1040, currency="EUR",
                      splits=[{"subscription_id": 1, "amount": 560}, {"subscription_id": 2, "amount": 560}])


class _FakeDB:
    """Stands in for the session where the code only asks for a subscription's
    unconfirmed payments."""
    def __init__(self, unconfirmed=()):
        self.unconfirmed, self.added, self.deleted = list(unconfirmed), [], []

    async def execute(self, _stmt):
        rows = self.unconfirmed
        return SimpleNamespace(unique=lambda: SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: rows)))

    def add(self, obj):
        self.added.append(obj)

    async def delete(self, obj):
        self.deleted.append(obj)


def _expected(pid, start, end, **kw):
    base = dict(id=pid, subscription_id=1, status="unconfirmed", period_start=start, period_end=end,
                amount=96.0, currency="USD", amount_aed=352.56, invoice_no=None, invoice_file=None,
                notes=None, paid_on=start, created_by="system")
    base.update(kw)
    return SimpleNamespace(**base)


async def test_invoice_confirms_the_expected_payment_instead_of_adding_one(fx):
    fx("")
    sub = _sub(vendor="LucidLink", product="Filespace", currency="USD", price=96,
               next_renewal=date(2027, 1, 3), reminded_for=None)
    november = _expected(63, date(2026, 11, 3), date(2026, 12, 2))
    december = _expected(70, date(2026, 12, 3), date(2027, 1, 2))
    db = _FakeDB([november, december])

    p, merged = await ps.settle_invoice(
        db, sub, paid_on=date(2026, 12, 3), amount=224, currency="USD", amount_aed=822.64,
        invoice_no="BD29A3F6-0033", created_by="admin", supplier="LucidLink Corp.",
        period_start=date(2026, 12, 3), period_end=date(2027, 1, 2),
    )
    assert merged is True and p is december and db.added == []
    assert (p.status, p.amount, p.amount_aed, p.invoice_no) == ("confirmed", 224, 822.64, "BD29A3F6-0033")
    assert november.status == "unconfirmed"            # the other month is not touched
    assert sub.seller is None                          # "LucidLink Corp." is the same name, nothing to remember
    assert sub.next_renewal == date(2027, 1, 3)        # the job had already rolled it


async def test_invoice_without_a_period_takes_the_one_its_date_falls_in(fx):
    fx("")
    sub = _sub(next_renewal=date(2026, 12, 3), reminded_for=None)
    november = _expected(63, date(2026, 11, 3), date(2026, 12, 2))
    p, merged = await ps.settle_invoice(
        _FakeDB([november]), sub, paid_on=date(2026, 11, 5), amount=224, currency="USD",
        amount_aed=822.64, invoice_no="X-1", created_by="admin",
    )
    assert merged and p is november and p.period_start == date(2026, 11, 3)


async def test_invoice_ahead_of_renewal_is_a_new_payment_and_moves_the_date(fx):
    fx("")
    sub = _sub(id=4, vendor="Proxmox", product="PBS", cycle_months=12, currency="EUR", price=560,
               next_renewal=date(2027, 10, 15), reminded_for=date(2027, 10, 15), budget_id=2, card_id=None)
    db = _FakeDB()
    p, merged = await ps.settle_invoice(
        db, sub, paid_on=date(2027, 9, 15), amount=560, currency="EUR", amount_aed=2307.2,
        invoice_no="300001", created_by="admin", supplier="Proxmox Server Solutions GmbH",
        period_start=date(2027, 10, 15), period_end=date(2028, 10, 14),
    )
    assert merged is False and db.added == [p]
    assert (p.subscription_id, p.vendor, p.budget_id, p.status) == (4, "Proxmox", 2, "confirmed")
    assert sub.seller == "Proxmox Server Solutions GmbH"   # the legal name is kept for the next match
    # the renewal job now finds nothing due on 15 Oct 2027 — no phantom twin
    assert (sub.next_renewal, sub.reminded_for) == (date(2028, 10, 15), None)


async def test_linking_a_logged_invoice_drops_the_expected_twin(fx):
    fx("")
    sub = _sub(vendor="LucidLink", next_renewal=date(2026, 12, 3), reminded_for=None)
    twin = _expected(63, date(2026, 11, 3), date(2026, 12, 2))
    db = _FakeDB([twin])
    invoice = SimpleNamespace(id=83, subscription_id=None, vendor="LucidLink Corp.", status="confirmed",
                              paid_on=date(2026, 11, 3), period_start=None, period_end=None,
                              budget_id=None, card_id=None, payment_method="card",
                              invoice_no="BD29A3F6-0032", invoice_file="83-x.pdf")
    assert await ps.link_payment(db, invoice, sub) is True
    assert db.deleted == [twin]
    assert (invoice.subscription_id, invoice.vendor, invoice.period_start) == (1, "LucidLink", date(2026, 11, 3))
    # an old invoice with nothing expected around it just gets attached
    old = SimpleNamespace(id=73, subscription_id=None, vendor="LucidLink Corp.", status="confirmed",
                          paid_on=date(2026, 1, 3), period_start=None, period_end=None,
                          budget_id=None, card_id=None, payment_method="card",
                          invoice_no="BD29A3F6-0022", invoice_file="73-x.pdf")
    assert await ps.link_payment(_FakeDB(), old, sub) is False and sub.next_renewal == date(2026, 12, 3)


async def test_invoice_takes_over_an_invoiceless_payment_for_the_same_period(fx):
    fx("")
    sub = _sub(id=3, vendor="Adobe", product="Creative Cloud", cycle_months=1, currency="AED", price=8800,
               next_renewal=date(2026, 11, 23), reminded_for=None)
    march = _expected(27, date(2026, 3, 23), date(2026, 4, 22), status="confirmed", created_by="import",
                      amount=8243.0, currency="AED", amount_aed=8243.0)
    db = _FakeDB([march])
    # A pro-rated top-up inside March's period is its own payment…
    top_up, merged = await ps.settle_invoice(
        db, sub, paid_on=date(2026, 4, 3), amount=209, currency="AED", amount_aed=209, invoice_no="3416428227",
        created_by="admin", period_start=date(2026, 4, 3), period_end=date(2026, 4, 22))
    assert not merged and top_up is not march and db.added == [top_up]
    # …the month's own invoice lands on the imported row.
    p, merged = await ps.settle_invoice(
        db, sub, paid_on=date(2026, 3, 23), amount=8243, currency="AED", amount_aed=8243, invoice_no="3405512706",
        created_by="admin", period_start=date(2026, 3, 23), period_end=date(2026, 4, 22))
    assert merged and p is march and p.invoice_no == "3405512706"
    assert sub.next_renewal == date(2026, 11, 23)       # an old period moves nothing


def test_pdf_with_several_invoices_is_cut_by_invoice_number():
    from app.services.intake_service import invoice_page_groups
    page = "INVOICE\nInvoice Information\nInvoice Number {}\nInvoice Date 23-FEB-2026\nPage 1 of 1"
    assert invoice_page_groups([page.format("3375489370"), page.format("3345474220"), "continued, no header"]) == [
        ("3375489370", [0]), ("3345474220", [1, 2])]
    # One invoice over two pages, or nothing recognisable: left whole.
    assert invoice_page_groups([page.format("290135"), page.format("290135")]) == [("290135", [0, 1])]
    assert invoice_page_groups(["scan without text", ""]) == [(None, [0, 1])]


async def test_one_time_top_up_settles_nothing(fx):
    fx("")
    sub = _sub(id=3, vendor="Adobe", product="Creative Cloud", cycle_months=1, currency="AED", price=8800,
               next_renewal=date(2026, 4, 23), reminded_for=date(2026, 4, 23))
    april = _expected(40, date(2026, 3, 23), date(2026, 4, 22))
    db = _FakeDB([april])
    p, merged = await ps.settle_invoice(
        db, sub, paid_on=date(2026, 4, 16), amount=61.6, currency="AED", amount_aed=61.6, invoice_no="3429353872",
        created_by="admin", period_start=date(2026, 4, 16), period_end=date(2026, 4, 22), one_time=True)
    assert not merged and db.added == [p] and april.status == "unconfirmed"
    assert (p.subscription_id, p.period_start, p.period_end) == (3, date(2026, 4, 16), date(2026, 4, 22))
    assert (sub.next_renewal, sub.reminded_for) == (date(2026, 4, 23), date(2026, 4, 23))
