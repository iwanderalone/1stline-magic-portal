"""Subscriptions & Purchases API — what the office pays for, who sits on the
seats, and the payment log. Admin/manager only: it is finance data.

GET    /purchases/meta                       categories, methods, currencies, FX table
GET    /purchases/summary                    dashboard tiles + upcoming renewals
GET    /purchases/departments                budgets            POST / PATCH /{id}
GET    /purchases/cards                      payment cards      POST / PATCH /{id}
GET    /purchases/subscriptions              catalog (filters: status, q, budget_id, category)
POST   /purchases/subscriptions              create
GET    /purchases/subscriptions/{id}         one, with seats
PATCH  /purchases/subscriptions/{id}         update (only sent fields)
DELETE /purchases/subscriptions/{id}         delete (payments are kept, unlinked)
POST   /purchases/subscriptions/{id}/renew   record this period as paid and roll next_renewal forward
POST   /purchases/subscriptions/{id}/seats   assign a seat       PATCH / DELETE /purchases/seats/{id}
GET    /purchases/people                     seat holders, grouped per person (+ NetBox leaver check)
GET    /purchases/payments                   payment log (filters: from, to, subscription_id, status, q)
POST   /purchases/payments                   add one            PATCH / DELETE /purchases/payments/{id}
POST   /purchases/payments/{id}/invoice      attach invoice     GET to download
GET    /purchases/report.xlsx                Excel report for a date range
"""
import json
import logging
import re
import uuid
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.deps import get_or_404, require_admin_or_manager
from app.models.models import (
    Department, PaymentCard, PurchasePayment, Subscription, SubscriptionSeat, User,
)
from app.schemas.schemas import (
    DepartmentIn, DepartmentOut, PaymentCardIn, PaymentCardOut, PaymentIn, PaymentOut,
    PaymentPatch, PaymentsPage, SeatHolder, SeatIn, SeatOut, SubscriptionIn,
    SubscriptionOut, SubscriptionPatch,
)
from app.services import netbox_service as nbs
from app.services import purchases_service as ps
from app.services.audit import log_action

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/purchases", tags=["purchases"],
                   dependencies=[Depends(require_admin_or_manager)])

_INVOICE_DIR = Path(__file__).parent.parent.parent / "data" / "invoices"
_INVOICE_TYPES = {"pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg"}
_INVOICE_MAX_BYTES = 15 * 1024 * 1024


# ─── Serialisation ───────────────────────────────────────

async def _user_names(db: AsyncSession) -> dict[str, str]:
    rows = (await db.execute(select(User.id, User.display_name, User.username))).all()
    return {str(r.id): (r.display_name or r.username) for r in rows}


def _sub_out(sub: Subscription, names: dict[str, str], today: Optional[date] = None) -> SubscriptionOut:
    today = today or date.today()
    price_aed = ps.to_aed(sub.price or 0, sub.currency)
    monthly = ps.monthly_aed(sub)
    return SubscriptionOut(
        id=sub.id, vendor=sub.vendor, product=sub.product, category=sub.category,
        seller=sub.seller,
        owners=[{"id": i, "display_name": names[i]} for i in ps.owner_ids(sub) if i in names],
        budget=sub.budget, account_email=sub.account_email, billing_url=sub.billing_url,
        reference=sub.reference, payment_method=sub.payment_method, card=sub.card,
        cycle_months=sub.cycle_months, price=sub.price or 0, currency=sub.currency,
        price_aed=price_aed, price_usd=ps.aed_to_usd(price_aed),
        monthly_aed=monthly, monthly_usd=ps.aed_to_usd(monthly),
        seats_total=sub.seats_total, seats_used=len(sub.seats),
        next_renewal=sub.next_renewal,
        days_to_renewal=(sub.next_renewal - today).days if sub.next_renewal else None,
        auto_renew=sub.auto_renew, lapsed=ps.is_lapsed(sub, today), status=sub.status,
        cancelled_on=sub.cancelled_on, notify_days_before=sub.notify_days_before,
        notes=sub.notes, updated_at=sub.updated_at,
    )


def _pay_out(p: PurchasePayment) -> PaymentOut:
    out = PaymentOut.model_validate(p)
    out.amount_usd = ps.aed_to_usd(p.amount_aed)
    out.has_invoice = bool(p.invoice_file)
    return out


async def _check_refs(db: AsyncSession, budget_id: Optional[int], card_id: Optional[int]):
    if budget_id is not None:
        await get_or_404(db, Department, budget_id)
    if card_id is not None:
        await get_or_404(db, PaymentCard, card_id)


# populate_existing: the session keeps objects across commits
# (expire_on_commit=False), so a re-select must overwrite the identity-map copy
# or a just-created row would come back without its relationships loaded.
async def _load_sub(db: AsyncSession, sub_id: int) -> Subscription:
    sub = (await db.execute(
        select(Subscription).where(Subscription.id == sub_id).execution_options(populate_existing=True)
    )).unique().scalar_one_or_none()
    if sub is None:
        raise HTTPException(status_code=404)
    return sub


async def _load_payment(db: AsyncSession, payment_id: int) -> PurchasePayment:
    p = (await db.execute(
        select(PurchasePayment).where(PurchasePayment.id == payment_id).execution_options(populate_existing=True)
    )).unique().scalar_one_or_none()
    if p is None:
        raise HTTPException(status_code=404)
    return p


# ─── Meta & summary ──────────────────────────────────────

@router.get("/meta")
async def meta():
    return {
        "categories": ps.CATEGORIES,
        "payment_methods": ps.PAYMENT_METHODS,
        "currencies": sorted(set(ps.CURRENCIES) | set(ps.fx_table())),
        "fx_to_aed": ps.fx_table(),
        "aed_per_usd": ps.AED_PER_USD,
        "netbox_url": get_settings().NETBOX_URL.rstrip("/") or None,
    }


@router.get("/summary")
async def summary(db: AsyncSession = Depends(get_db)):
    today = date.today()
    subs = (await db.execute(select(Subscription).where(Subscription.status == "active"))).unique().scalars().all()
    names = await _user_names(db)

    run_rate = 0.0
    by_budget: dict[str, float] = defaultdict(float)
    by_category: dict[str, float] = defaultdict(float)
    unknown_fx = []
    seats_total = seats_used = 0
    over_assigned = []
    for s in subs:
        m = ps.monthly_aed(s)
        if m is None:
            unknown_fx.append(s.vendor)
            continue
        run_rate += m
        by_budget[s.budget.name if s.budget else "—"] += m
        by_category[s.category] += m
        if s.seats_total:
            seats_total += s.seats_total
            seats_used += min(len(s.seats), s.seats_total)
            if len(s.seats) > s.seats_total:
                over_assigned.append(s.vendor)

    horizon = today + timedelta(days=30)
    upcoming = sorted(
        (s for s in subs if s.next_renewal and today <= s.next_renewal <= horizon),
        key=lambda s: s.next_renewal,
    )
    lapsed = [s for s in subs if ps.is_lapsed(s, today)]

    # 12-month spend history from the payment log (confirmed + unconfirmed).
    start = ps.add_months(today.replace(day=1), -11)
    rows = (await db.execute(
        select(func.date_trunc("month", PurchasePayment.paid_on).label("m"), func.sum(PurchasePayment.amount_aed))
        .where(PurchasePayment.paid_on >= start)
        .group_by("m").order_by("m")
    )).all()
    spent = {r[0].date().replace(day=1): float(r[1] or 0) for r in rows}
    months = [ps.add_months(start, i) for i in range(12)]
    unconfirmed = (await db.execute(
        select(func.count(PurchasePayment.id)).where(PurchasePayment.status == "unconfirmed")
    )).scalar() or 0

    def rank(d: dict) -> list[dict]:
        return [{"name": k, "monthly_aed": round(v, 2), "monthly_usd": ps.aed_to_usd(v)}
                for k, v in sorted(d.items(), key=lambda kv: -kv[1])]

    return {
        "active_count": len(subs),
        "monthly_aed": round(run_rate, 2), "monthly_usd": ps.aed_to_usd(run_rate),
        "yearly_aed": round(run_rate * 12, 2), "yearly_usd": ps.aed_to_usd(run_rate * 12),
        "by_budget": rank(by_budget),
        "by_category": rank(by_category),
        "seats_total": seats_total, "seats_used": seats_used, "over_assigned": over_assigned,
        "unconfirmed_payments": unconfirmed,
        "unknown_fx": unknown_fx,
        "upcoming": [_sub_out(s, names, today) for s in upcoming],
        "lapsed": [_sub_out(s, names, today) for s in lapsed],
        "spend_by_month": [{"month": m.isoformat(), "aed": round(spent.get(m, 0), 2),
                            "usd": ps.aed_to_usd(spent.get(m, 0))} for m in months],
    }


# ─── Departments (budgets) & cards ───────────────────────

@router.get("/departments", response_model=list[DepartmentOut])
async def list_departments(db: AsyncSession = Depends(get_db)):
    return (await db.execute(select(Department).order_by(Department.name))).scalars().all()


@router.post("/departments", response_model=DepartmentOut, status_code=201)
async def create_department(body: DepartmentIn, db: AsyncSession = Depends(get_db),
                            user: User = Depends(require_admin_or_manager)):
    if (await db.execute(select(Department.id).where(func.lower(Department.name) == body.name.strip().lower()))).first():
        raise HTTPException(status_code=409, detail="A budget with this name already exists")
    dept = Department(name=body.name.strip(), is_active=body.is_active)
    db.add(dept)
    await log_action(db, user, "purchases.department_create", dept.name)
    await db.commit()
    await db.refresh(dept)
    return dept


@router.patch("/departments/{dept_id}", response_model=DepartmentOut)
async def update_department(dept_id: int, body: DepartmentIn, db: AsyncSession = Depends(get_db),
                            user: User = Depends(require_admin_or_manager)):
    dept = await get_or_404(db, Department, dept_id)
    dept.name, dept.is_active = body.name.strip(), body.is_active
    await log_action(db, user, "purchases.department_update", dept.name)
    await db.commit()
    await db.refresh(dept)
    return dept


@router.get("/cards", response_model=list[PaymentCardOut])
async def list_cards(db: AsyncSession = Depends(get_db)):
    return (await db.execute(select(PaymentCard).order_by(PaymentCard.label))).scalars().all()


@router.post("/cards", response_model=PaymentCardOut, status_code=201)
async def create_card(body: PaymentCardIn, db: AsyncSession = Depends(get_db),
                      user: User = Depends(require_admin_or_manager)):
    card = PaymentCard(**body.model_dump())
    db.add(card)
    await log_action(db, user, "purchases.card_create", card.label)
    await db.commit()
    await db.refresh(card)
    return card


@router.patch("/cards/{card_id}", response_model=PaymentCardOut)
async def update_card(card_id: int, body: PaymentCardIn, db: AsyncSession = Depends(get_db),
                      user: User = Depends(require_admin_or_manager)):
    card = await get_or_404(db, PaymentCard, card_id)
    for k, v in body.model_dump().items():
        setattr(card, k, v)
    await log_action(db, user, "purchases.card_update", card.label)
    await db.commit()
    await db.refresh(card)
    return card


# ─── Subscriptions ───────────────────────────────────────

@router.get("/subscriptions", response_model=list[SubscriptionOut])
async def list_subscriptions(
    status: Optional[str] = Query(default="active"),  # active|cancelled|all
    q: Optional[str] = None,
    budget_id: Optional[int] = None,
    category: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    stmt = select(Subscription)
    if status and status != "all":
        stmt = stmt.where(Subscription.status == status)
    if budget_id:
        stmt = stmt.where(Subscription.budget_id == budget_id)
    if category:
        stmt = stmt.where(Subscription.category == category)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(
            Subscription.vendor.ilike(like), Subscription.product.ilike(like),
            Subscription.account_email.ilike(like), Subscription.reference.ilike(like),
            Subscription.notes.ilike(like), Subscription.seller.ilike(like),
        ))
    stmt = stmt.order_by(Subscription.next_renewal.asc().nulls_last(), Subscription.vendor)
    subs = (await db.execute(stmt)).unique().scalars().all()
    names = await _user_names(db)
    return [_sub_out(s, names) for s in subs]


@router.post("/subscriptions", response_model=SubscriptionOut, status_code=201)
async def create_subscription(body: SubscriptionIn, db: AsyncSession = Depends(get_db),
                              user: User = Depends(require_admin_or_manager)):
    await _check_refs(db, body.budget_id, body.card_id)
    data = body.model_dump()
    data["owner_user_ids"] = json.dumps([str(u) for u in body.owner_user_ids])
    sub = Subscription(**data)
    db.add(sub)
    await log_action(db, user, "purchases.subscription_create", f"{sub.vendor} {sub.product or ''}".strip())
    await db.commit()
    sub = await _load_sub(db, sub.id)
    return _sub_out(sub, await _user_names(db))


@router.get("/subscriptions/{sub_id}")
async def get_subscription(sub_id: int, db: AsyncSession = Depends(get_db)):
    sub = await _load_sub(db, sub_id)
    payments = (await db.execute(
        select(PurchasePayment).where(PurchasePayment.subscription_id == sub_id)
        .order_by(PurchasePayment.paid_on.desc()).limit(24)
    )).unique().scalars().all()
    out = _sub_out(sub, await _user_names(db)).model_dump(mode="json")
    out["seats"] = [SeatOut.model_validate(s).model_dump(mode="json") for s in sub.seats]
    out["payments"] = [_pay_out(p).model_dump(mode="json") for p in payments]
    return out


@router.patch("/subscriptions/{sub_id}", response_model=SubscriptionOut)
async def update_subscription(sub_id: int, body: SubscriptionPatch, db: AsyncSession = Depends(get_db),
                              user: User = Depends(require_admin_or_manager)):
    sub = await _load_sub(db, sub_id)
    data = body.model_dump(exclude_unset=True)
    await _check_refs(db, data.get("budget_id"), data.get("card_id"))
    if "owner_user_ids" in data:
        data["owner_user_ids"] = json.dumps([str(u) for u in (data["owner_user_ids"] or [])])
    if data.get("next_renewal") and data["next_renewal"] != sub.next_renewal:
        sub.reminded_for = None  # a moved date deserves a fresh reminder
    if data.get("status") == "cancelled" and sub.status != "cancelled" and not data.get("cancelled_on"):
        data["cancelled_on"] = date.today()
    for k, v in data.items():
        setattr(sub, k, v)
    await log_action(db, user, "purchases.subscription_update",
                     f"{sub.vendor}: {', '.join(sorted(data))}")
    await db.commit()
    sub = await _load_sub(db, sub_id)
    return _sub_out(sub, await _user_names(db))


@router.delete("/subscriptions/{sub_id}", status_code=204)
async def delete_subscription(sub_id: int, db: AsyncSession = Depends(get_db),
                              user: User = Depends(require_admin_or_manager)):
    sub = await _load_sub(db, sub_id)
    await log_action(db, user, "purchases.subscription_delete", f"{sub.vendor} {sub.product or ''}".strip())
    await db.delete(sub)
    await db.commit()
    return Response(status_code=204)


@router.post("/subscriptions/{sub_id}/renew", response_model=PaymentOut)
async def renew_subscription(sub_id: int, db: AsyncSession = Depends(get_db),
                             user: User = Depends(require_admin_or_manager)):
    """'We paid this period': log it as confirmed and move the date one cycle."""
    sub = await _load_sub(db, sub_id)
    if not sub.next_renewal:
        raise HTTPException(status_code=400, detail="Set a renewal date first")
    payment = ps.payment_from_subscription(sub, sub.next_renewal, status="confirmed", created_by=user.username)
    db.add(payment)
    sub.next_renewal = ps.add_months(sub.next_renewal, sub.cycle_months or 1)
    sub.reminded_for = None
    await log_action(db, user, "purchases.subscription_renew", f"{sub.vendor} → {sub.next_renewal}")
    await db.commit()
    return _pay_out(await _load_payment(db, payment.id))


# ─── Seats ───────────────────────────────────────────────

@router.post("/subscriptions/{sub_id}/seats", response_model=SeatOut, status_code=201)
async def add_seat(sub_id: int, body: SeatIn, db: AsyncSession = Depends(get_db),
                   user: User = Depends(require_admin_or_manager)):
    sub = await _load_sub(db, sub_id)
    if body.netbox_contact_id and any(s.netbox_contact_id == body.netbox_contact_id for s in sub.seats):
        raise HTTPException(status_code=409, detail="This person already has a seat on this subscription")
    seat = SubscriptionSeat(subscription_id=sub_id, **body.model_dump())
    if seat.assigned_on is None:
        seat.assigned_on = date.today()
    db.add(seat)
    await log_action(db, user, "purchases.seat_assign", f"{sub.vendor}: {seat.person_name}")
    await db.commit()
    await db.refresh(seat)
    return seat


@router.patch("/seats/{seat_id}", response_model=SeatOut)
async def update_seat(seat_id: int, body: SeatIn, db: AsyncSession = Depends(get_db),
                      user: User = Depends(require_admin_or_manager)):
    seat = await get_or_404(db, SubscriptionSeat, seat_id)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(seat, k, v)
    await log_action(db, user, "purchases.seat_update", seat.person_name)
    await db.commit()
    await db.refresh(seat)
    return seat


@router.delete("/seats/{seat_id}", status_code=204)
async def remove_seat(seat_id: int, db: AsyncSession = Depends(get_db),
                      user: User = Depends(require_admin_or_manager)):
    seat = await get_or_404(db, SubscriptionSeat, seat_id)
    await log_action(db, user, "purchases.seat_remove", f"subscription {seat.subscription_id}: {seat.person_name}")
    await db.delete(seat)
    await db.commit()
    return Response(status_code=204)


@router.get("/people", response_model=list[SeatHolder])
async def seat_holders(
    q: Optional[str] = None,
    contact_id: Optional[int] = None,
    leavers_only: bool = False,
    check_netbox: bool = True,
    db: AsyncSession = Depends(get_db),
):
    """Every seat, grouped per person. `leavers_only` keeps people the AD sync
    marked as gone — the "licenses to take back" list."""
    stmt = select(SubscriptionSeat, Subscription).join(Subscription, Subscription.id == SubscriptionSeat.subscription_id)
    if contact_id:
        stmt = stmt.where(SubscriptionSeat.netbox_contact_id == contact_id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(SubscriptionSeat.person_name.ilike(like), SubscriptionSeat.person_email.ilike(like),
                              SubscriptionSeat.login.ilike(like)))
    rows = (await db.execute(stmt.order_by(SubscriptionSeat.person_name))).unique().all()

    groups: dict[str, dict] = {}
    for seat, sub in rows:
        key = f"nb:{seat.netbox_contact_id}" if seat.netbox_contact_id else f"name:{seat.person_name.strip().lower()}"
        g = groups.setdefault(key, {
            "netbox_contact_id": seat.netbox_contact_id, "person_name": seat.person_name,
            "person_email": seat.person_email, "person_department": seat.person_department,
            "offboarded": None, "seats": [],
        })
        g["seats"].append({
            "seat_id": seat.id, "subscription_id": sub.id, "vendor": sub.vendor, "product": sub.product,
            "login": seat.login or seat.person_email, "assigned_on": seat.assigned_on.isoformat() if seat.assigned_on else None,
            "status": sub.status, "account_email": sub.account_email,
        })

    if (check_netbox or leavers_only) and nbs.enabled():
        ids = [g["netbox_contact_id"] for g in groups.values() if g["netbox_contact_id"]]
        try:
            contacts = await nbs.get_contacts_by_ids(ids) if ids else {}
            for g in groups.values():
                cid = g["netbox_contact_id"]
                if cid:
                    # Gone from NetBox entirely counts as a leaver too.
                    g["offboarded"] = contacts[cid]["offboarded"] if cid in contacts else True
        except nbs.NetboxError as exc:
            logger.warning("[purchases] NetBox leaver check failed: %s", exc)
            if leavers_only:
                raise HTTPException(status_code=502, detail=f"NetBox check failed: {exc}")

    out = list(groups.values())
    if leavers_only:
        out = [g for g in out if g["offboarded"]]
    return out


# ─── Payments ────────────────────────────────────────────

def _payments_filter(stmt, date_from, date_to, subscription_id, status, q, budget_id):
    if date_from:
        stmt = stmt.where(PurchasePayment.paid_on >= date_from)
    if date_to:
        stmt = stmt.where(PurchasePayment.paid_on <= date_to)
    if subscription_id:
        stmt = stmt.where(PurchasePayment.subscription_id == subscription_id)
    if status:
        stmt = stmt.where(PurchasePayment.status == status)
    if budget_id:
        stmt = stmt.where(PurchasePayment.budget_id == budget_id)
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(PurchasePayment.vendor.ilike(like), PurchasePayment.description.ilike(like),
                              PurchasePayment.invoice_no.ilike(like), PurchasePayment.notes.ilike(like)))
    return stmt


@router.get("/payments", response_model=PaymentsPage)
async def list_payments(
    date_from: Optional[date] = Query(default=None, alias="from"),
    date_to: Optional[date] = Query(default=None, alias="to"),
    subscription_id: Optional[int] = None,
    status: Optional[str] = None,
    budget_id: Optional[int] = None,
    q: Optional[str] = None,
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=100, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
):
    args = (date_from, date_to, subscription_id, status, q, budget_id)
    total, total_aed = (await db.execute(
        _payments_filter(select(func.count(PurchasePayment.id), func.coalesce(func.sum(PurchasePayment.amount_aed), 0)), *args)
    )).one()
    rows = (await db.execute(
        _payments_filter(select(PurchasePayment), *args)
        .order_by(PurchasePayment.paid_on.desc(), PurchasePayment.id.desc())
        .offset((page - 1) * page_size).limit(page_size)
    )).unique().scalars().all()
    return PaymentsPage(items=[_pay_out(p) for p in rows], total=total,
                        total_aed=round(float(total_aed), 2), total_usd=ps.aed_to_usd(float(total_aed)))


def _apply_payment_defaults(p: PurchasePayment, sub: Optional[Subscription], sent: set[str]):
    """Unsent fields inherit from the linked subscription; AED is converted
    from the vendor amount when not typed in."""
    if sub:
        for field in ("vendor", "category", "budget_id", "payment_method", "card_id"):
            if getattr(p, field) is None:
                setattr(p, field, getattr(sub, field))
        if p.description is None:
            p.description = sub.product
    if not p.vendor:
        raise HTTPException(status_code=422, detail="Vendor is required for a payment without a subscription")
    p.category = p.category or "other"
    p.payment_method = p.payment_method or "card"
    if p.amount_aed is None or ("amount_aed" not in sent and sent & {"amount", "currency"}):
        aed = ps.to_aed(p.amount, p.currency)
        if aed is None:
            raise HTTPException(status_code=422, detail=f"No exchange rate for {p.currency} — enter the AED amount")
        p.amount_aed = aed


@router.post("/payments", response_model=PaymentOut, status_code=201)
async def create_payment(body: PaymentIn, db: AsyncSession = Depends(get_db),
                         user: User = Depends(require_admin_or_manager)):
    await _check_refs(db, body.budget_id, body.card_id)
    sub = await _load_sub(db, body.subscription_id) if body.subscription_id else None
    p = PurchasePayment(**body.model_dump(), created_by=user.username)
    _apply_payment_defaults(p, sub, body.model_fields_set)
    db.add(p)
    await log_action(db, user, "purchases.payment_create", f"{p.vendor} {p.amount} {p.currency} on {p.paid_on}")
    await db.commit()
    return _pay_out(await _load_payment(db, p.id))


@router.patch("/payments/{payment_id}", response_model=PaymentOut)
async def update_payment(payment_id: int, body: PaymentPatch, db: AsyncSession = Depends(get_db),
                         user: User = Depends(require_admin_or_manager)):
    p = await _load_payment(db, payment_id)
    data = body.model_dump(exclude_unset=True)
    await _check_refs(db, data.get("budget_id"), data.get("card_id"))
    for k, v in data.items():
        setattr(p, k, v)
    sub = await _load_sub(db, p.subscription_id) if p.subscription_id else None
    _apply_payment_defaults(p, sub, set(data))
    await log_action(db, user, "purchases.payment_update", f"#{p.id} {p.vendor}: {', '.join(sorted(data))}")
    await db.commit()
    return _pay_out(await _load_payment(db, payment_id))


@router.delete("/payments/{payment_id}", status_code=204)
async def delete_payment(payment_id: int, db: AsyncSession = Depends(get_db),
                         user: User = Depends(require_admin_or_manager)):
    p = await get_or_404(db, PurchasePayment, payment_id)
    if p.invoice_file:
        (_INVOICE_DIR / p.invoice_file).unlink(missing_ok=True)
    await log_action(db, user, "purchases.payment_delete", f"#{p.id} {p.vendor} {p.amount} {p.currency} on {p.paid_on}")
    await db.delete(p)
    await db.commit()
    return Response(status_code=204)


@router.post("/payments/{payment_id}/invoice", response_model=PaymentOut)
async def upload_invoice(payment_id: int, file: UploadFile = File(...), db: AsyncSession = Depends(get_db),
                         user: User = Depends(require_admin_or_manager)):
    p = await get_or_404(db, PurchasePayment, payment_id)
    ext = (file.filename or "").rsplit(".", 1)[-1].lower()
    if ext not in _INVOICE_TYPES:
        raise HTTPException(status_code=400, detail="Invoice must be a PDF, PNG or JPG")
    content = await file.read(_INVOICE_MAX_BYTES + 1)
    if len(content) > _INVOICE_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Invoice is larger than 15 MB")
    _INVOICE_DIR.mkdir(parents=True, exist_ok=True)
    if p.invoice_file:
        (_INVOICE_DIR / p.invoice_file).unlink(missing_ok=True)
    # Server-chosen name: the uploaded filename never touches the filesystem.
    p.invoice_file = f"{p.id}-{uuid.uuid4().hex[:12]}.{ext}"
    (_INVOICE_DIR / p.invoice_file).write_bytes(content)
    await log_action(db, user, "purchases.invoice_upload", f"#{p.id} {p.vendor}")
    await db.commit()
    return _pay_out(await _load_payment(db, payment_id))


@router.get("/payments/{payment_id}/invoice")
async def download_invoice(payment_id: int, db: AsyncSession = Depends(get_db)):
    p = await get_or_404(db, PurchasePayment, payment_id)
    path = _INVOICE_DIR / (p.invoice_file or "")
    if not p.invoice_file or not path.is_file():
        raise HTTPException(status_code=404, detail="No invoice attached")
    ext = p.invoice_file.rsplit(".", 1)[-1]
    safe_vendor = re.sub(r"[^A-Za-z0-9_-]+", "_", p.vendor)[:40]
    return FileResponse(path, media_type=_INVOICE_TYPES.get(ext, "application/octet-stream"),
                        filename=f"invoice-{safe_vendor}-{p.paid_on}.{ext}")


# ─── Report ──────────────────────────────────────────────

@router.get("/report.xlsx")
async def report(
    date_from: Optional[date] = Query(default=None, alias="from"),
    date_to: Optional[date] = Query(default=None, alias="to"),
    db: AsyncSession = Depends(get_db),
):
    from app.services.purchases_report import build_report

    today = date.today()
    date_from = date_from or today.replace(month=1, day=1)
    date_to = date_to or today
    if date_from > date_to:
        raise HTTPException(status_code=400, detail="'from' is after 'to'")

    subs = (await db.execute(select(Subscription).order_by(Subscription.vendor))).unique().scalars().all()
    payments = (await db.execute(
        select(PurchasePayment).where(PurchasePayment.paid_on >= date_from, PurchasePayment.paid_on <= date_to)
        .order_by(PurchasePayment.paid_on, PurchasePayment.vendor)
    )).unique().scalars().all()
    leavers: set[int] = set()
    if nbs.enabled():
        ids = [seat.netbox_contact_id for s in subs for seat in s.seats if seat.netbox_contact_id]
        try:
            contacts = await nbs.get_contacts_by_ids(ids) if ids else {}
            leavers = {i for i in ids if i not in contacts or contacts[i]["offboarded"]}
        except nbs.NetboxError as exc:
            logger.warning("[purchases] report: NetBox leaver check skipped: %s", exc)

    content = build_report(subs, payments, await _user_names(db), date_from, date_to, leavers)
    filename = f"it-purchases_{date_from}_{date_to}.xlsx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
