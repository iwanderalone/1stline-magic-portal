"""subscriptions & purchases: budgets, cards, subscriptions, seats, payments

Revision ID: a1922b15dc96
Revises: 3b74bea3ee8c
Branch labels: None
Depends on: None

"""
from alembic import op
import sqlalchemy as sa

revision = 'a1922b15dc96'
down_revision = '3b74bea3ee8c'
branch_labels = None
depends_on = None

# The AD OUs that hold a budget. Accounting folds into Finance and the
# Verification Desk into Newsroom; External / Shared mailboxes are not budgets.
DEPARTMENTS = [
    "Administration", "Broadcast Service", "Commercial Department", "Digital-Product",
    "Finance", "Government Relationships", "HR OM", "IT", "Legal", "Marketing",
    "Newsroom", "Production", "Social Media",
]


def upgrade():
    departments = op.create_table(
        'purchase_departments',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('name', sa.String(length=100), nullable=False, unique=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        'payment_cards',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('label', sa.String(length=100), nullable=False),
        sa.Column('last4', sa.String(length=4), nullable=True),
        sa.Column('holder', sa.String(length=100), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        'subscriptions',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('vendor', sa.String(length=200), nullable=False),
        sa.Column('product', sa.String(length=300), nullable=True),
        sa.Column('category', sa.String(length=30), nullable=False, server_default='software'),
        sa.Column('seller', sa.String(length=200), nullable=True),
        sa.Column('owner_user_ids', sa.Text(), nullable=True),
        sa.Column('budget_id', sa.Integer(), sa.ForeignKey('purchase_departments.id', ondelete='SET NULL'), nullable=True),
        sa.Column('account_email', sa.String(length=320), nullable=True),
        sa.Column('billing_url', sa.String(length=1000), nullable=True),
        sa.Column('reference', sa.String(length=300), nullable=True),
        sa.Column('payment_method', sa.String(length=20), nullable=False, server_default='card'),
        sa.Column('card_id', sa.Integer(), sa.ForeignKey('payment_cards.id', ondelete='SET NULL'), nullable=True),
        sa.Column('cycle_months', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('price', sa.Float(), nullable=False, server_default='0'),
        sa.Column('currency', sa.String(length=3), nullable=False, server_default='AED'),
        sa.Column('seats_total', sa.Integer(), nullable=True),
        sa.Column('next_renewal', sa.Date(), nullable=True),
        sa.Column('auto_renew', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='active'),
        sa.Column('cancelled_on', sa.Date(), nullable=True),
        sa.Column('notify_days_before', sa.Integer(), nullable=True),
        sa.Column('reminded_for', sa.Date(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('import_ref', sa.String(length=50), nullable=True, unique=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_subscriptions_next_renewal', 'subscriptions', ['next_renewal'])
    op.create_table(
        'subscription_seats',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('subscription_id', sa.Integer(), sa.ForeignKey('subscriptions.id', ondelete='CASCADE'), nullable=False),
        sa.Column('netbox_contact_id', sa.Integer(), nullable=True),
        sa.Column('person_name', sa.String(length=200), nullable=False),
        sa.Column('person_email', sa.String(length=320), nullable=True),
        sa.Column('person_department', sa.String(length=100), nullable=True),
        sa.Column('login', sa.String(length=320), nullable=True),
        sa.Column('assigned_on', sa.Date(), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_subscription_seats_subscription_id', 'subscription_seats', ['subscription_id'])
    op.create_index('ix_subscription_seats_netbox_contact_id', 'subscription_seats', ['netbox_contact_id'])
    op.create_table(
        'purchase_payments',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('subscription_id', sa.Integer(), sa.ForeignKey('subscriptions.id', ondelete='SET NULL'), nullable=True),
        sa.Column('paid_on', sa.Date(), nullable=False),
        sa.Column('vendor', sa.String(length=200), nullable=False),
        sa.Column('description', sa.String(length=500), nullable=True),
        sa.Column('category', sa.String(length=30), nullable=False, server_default='software'),
        sa.Column('budget_id', sa.Integer(), sa.ForeignKey('purchase_departments.id', ondelete='SET NULL'), nullable=True),
        sa.Column('payment_method', sa.String(length=20), nullable=False, server_default='card'),
        sa.Column('card_id', sa.Integer(), sa.ForeignKey('payment_cards.id', ondelete='SET NULL'), nullable=True),
        sa.Column('amount', sa.Float(), nullable=False),
        sa.Column('currency', sa.String(length=3), nullable=False, server_default='AED'),
        sa.Column('amount_aed', sa.Float(), nullable=False),
        sa.Column('period_start', sa.Date(), nullable=True),
        sa.Column('period_end', sa.Date(), nullable=True),
        sa.Column('invoice_no', sa.String(length=100), nullable=True),
        sa.Column('invoice_file', sa.String(length=300), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='confirmed'),
        sa.Column('notes', sa.Text(), nullable=True),
        sa.Column('import_ref', sa.String(length=50), nullable=True, unique=True),
        sa.Column('created_by', sa.String(length=100), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_purchase_payments_subscription_id', 'purchase_payments', ['subscription_id'])
    op.create_index('ix_purchase_payments_paid_on', 'purchase_payments', ['paid_on'])

    op.bulk_insert(departments, [{"name": n} for n in DEPARTMENTS])


def downgrade():
    op.drop_table('purchase_payments')
    op.drop_table('subscription_seats')
    op.drop_table('subscriptions')
    op.drop_table('payment_cards')
    op.drop_table('purchase_departments')
