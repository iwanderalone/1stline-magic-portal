"""finances: editable categories + vendors

Categories move from a hard-coded list to `purchase_categories` (key stays the
value stored on subscriptions/payments), and the list itself is reshaped:
software → work software / IT tools / infrastructure licences, cloud → hosting /
storage, isp → internet, telecom → mobile.

Vendors become rows of their own (`purchase_vendors`): one Etisalat with five
services, one Proxmox with thirteen keys. The legal names printed on invoices
(the old per-subscription `seller`) become the vendor's aliases. `vendor` stays
on subscriptions/payments as the display name, kept in sync with the row.

Revision ID: b4c5d6e7f8a9
Revises: a3b4c5d6e7f8
"""
import json
import re
from collections import Counter, defaultdict

from alembic import op
import sqlalchemy as sa

revision = 'b4c5d6e7f8a9'
down_revision = 'a3b4c5d6e7f8'
branch_labels = None
depends_on = None

CATEGORIES = [
    # key, English, Russian
    ("internet", "Internet", "Интернет"),
    ("mobile", "Mobile", "Мобильная связь"),
    ("saas", "Work software", "Рабочий софт"),
    ("it_tools", "IT tools", "IT-инструменты"),
    ("infra_licences", "Infrastructure licences", "Лицензии инфраструктуры"),
    ("hosting", "Hosting", "Хостинг"),
    ("storage", "Storage", "Хранилище"),
    ("security", "Security", "Безопасность"),
    ("hardware", "Hardware", "Оборудование"),
    ("services", "Services", "Услуги"),
    ("other", "Other", "Прочее"),
]

_SIMPLE = {"isp": "internet", "telecom": "mobile", "cloud": "hosting", "software": "saas"}
_BY_VENDOR = {"lucidlink": "storage", "jamf": "it_tools", "rustdesk": "it_tools", "parsec": "it_tools",
              "proxmox": "infra_licences"}

_LEGAL = {"llc", "fze", "fzco", "fz", "co", "ltd", "limited", "inc", "est", "gmbh", "corp", "corporation",
          "pty", "ag", "sa", "bv", "srl", "sarl", "plc", "llp", "lp", "ooo", "company", "the"}


def _key(name):
    words = re.sub(r"[^a-z0-9]+", " ", (name or "").casefold()).split()
    return " ".join(w for w in words if len(w) > 1 and w not in _LEGAL)


def _new_category(old, vendor):
    if old in ("software", "cloud"):
        v = _key(vendor).split(" ")[0] if _key(vendor) else ""
        if v in _BY_VENDOR:
            return _BY_VENDOR[v]
    return _SIMPLE.get(old, old if old in {k for k, _, _ in CATEGORIES} else "other")


def upgrade():
    op.create_table(
        'purchase_categories',
        sa.Column('key', sa.String(30), primary_key=True),
        sa.Column('name', sa.String(100), nullable=False),
        sa.Column('name_ru', sa.String(100), nullable=True),
        sa.Column('sort', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.create_table(
        'purchase_vendors',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('name', sa.String(200), nullable=False, unique=True),
        sa.Column('aliases', sa.Text(), nullable=True),
        sa.Column('category', sa.String(30), nullable=True),
        sa.Column('website', sa.String(1000), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.add_column('subscriptions', sa.Column(
        'vendor_id', sa.Integer(), sa.ForeignKey('purchase_vendors.id', ondelete='SET NULL'), nullable=True))
    op.add_column('purchase_payments', sa.Column(
        'vendor_id', sa.Integer(), sa.ForeignKey('purchase_vendors.id', ondelete='SET NULL'), nullable=True))
    op.create_index('ix_subscriptions_vendor_id', 'subscriptions', ['vendor_id'])
    op.create_index('ix_purchase_payments_vendor_id', 'purchase_payments', ['vendor_id'])

    bind = op.get_bind()
    cats = sa.table('purchase_categories', sa.column('key'), sa.column('name'), sa.column('name_ru'), sa.column('sort'))
    op.bulk_insert(cats, [{"key": k, "name": n, "name_ru": r, "sort": i * 10} for i, (k, n, r) in enumerate(CATEGORIES)])

    subs = bind.execute(sa.text("select id, vendor, seller, category from subscriptions")).mappings().all()
    pays = bind.execute(sa.text(
        "select id, vendor, category, subscription_id from purchase_payments")).mappings().all()

    # Categories first — the vendor's default comes from the new ones.
    sub_cat = {}
    for s in subs:
        sub_cat[s["id"]] = _new_category(s["category"], s["vendor"])
        bind.execute(sa.text("update subscriptions set category=:c where id=:i"), {"c": sub_cat[s["id"]], "i": s["id"]})
    for p in pays:
        c = sub_cat.get(p["subscription_id"]) or _new_category(p["category"], p["vendor"])
        bind.execute(sa.text("update purchase_payments set category=:c where id=:i"), {"c": c, "i": p["id"]})

    # Vendors: one per normalised name; a subscription's spelling wins.
    groups = defaultdict(lambda: {"names": Counter(), "aliases": set(), "cats": Counter(), "subs": [], "pays": []})
    sub_group = {}
    for s in subs:
        k = _key(s["vendor"]) or s["vendor"].strip().casefold()
        g = groups[k]
        g["names"][s["vendor"].strip()] += 100
        if s["seller"] and _key(s["seller"]) != k:
            g["aliases"].add(s["seller"].strip())
        g["cats"][sub_cat[s["id"]]] += 1
        g["subs"].append(s["id"])
        sub_group[s["id"]] = k
    # A payment's supplier may be a subscription vendor's legal name.
    alias_group = {_key(a): k for k, g in groups.items() for a in g["aliases"]}
    for p in pays:
        if p["subscription_id"] in sub_group:
            groups[sub_group[p["subscription_id"]]]["pays"].append(p["id"])
            continue
        k = _key(p["vendor"]) or p["vendor"].strip().casefold()
        k = alias_group.get(k, k)
        g = groups[k]
        g["names"][p["vendor"].strip()] += 1
        g["cats"][_new_category(p["category"], p["vendor"])] += 1
        g["pays"].append(p["id"])

    used = set()
    for k, g in groups.items():
        name = g["names"].most_common(1)[0][0]
        while name.casefold() in used:          # two keys with one display spelling
            name += " (2)"
        used.add(name.casefold())
        others = sorted({n for n in g["names"] if n != name} | g["aliases"])
        vid = bind.execute(sa.text(
            "insert into purchase_vendors (name, aliases, category) values (:n, :a, :c) returning id"),
            {"n": name, "a": json.dumps(others) if others else None, "c": g["cats"].most_common(1)[0][0]},
        ).scalar()
        if g["subs"]:
            bind.execute(sa.text("update subscriptions set vendor_id=:v, vendor=:n where id = any(:ids)"),
                         {"v": vid, "n": name, "ids": g["subs"]})
        if g["pays"]:
            bind.execute(sa.text("update purchase_payments set vendor_id=:v, vendor=:n where id = any(:ids)"),
                         {"v": vid, "n": name, "ids": g["pays"]})


def downgrade():
    back = {"internet": "isp", "mobile": "telecom", "saas": "software", "it_tools": "software",
            "infra_licences": "software", "hosting": "cloud", "storage": "cloud"}
    for t in ("subscriptions", "purchase_payments"):
        for new, old in back.items():
            op.execute(f"update {t} set category='{old}' where category='{new}'")
        op.execute(f"update {t} set category='other' where category not in "
                   "('software','cloud','isp','telecom','security','hardware','services','other')")
    op.drop_index('ix_purchase_payments_vendor_id', 'purchase_payments')
    op.drop_index('ix_subscriptions_vendor_id', 'subscriptions')
    op.drop_column('purchase_payments', 'vendor_id')
    op.drop_column('subscriptions', 'vendor_id')
    op.drop_table('purchase_vendors')
    op.drop_table('purchase_categories')
