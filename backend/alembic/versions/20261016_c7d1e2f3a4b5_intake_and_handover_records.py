"""intake: payment ↔ NetBox devices link, handover records awaiting signature

Revision ID: c7d1e2f3a4b5
Revises: a1922b15dc96
Branch labels: None
Depends on: None

"""
from alembic import op
import sqlalchemy as sa

revision = 'c7d1e2f3a4b5'
down_revision = 'a1922b15dc96'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('purchase_payments', sa.Column('netbox_device_ids', sa.Text(), nullable=True))
    op.create_table(
        'handover_records',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('employee_contact_id', sa.Integer(), nullable=False),
        sa.Column('employee_name', sa.String(length=200), nullable=False),
        sa.Column('handover_date', sa.Date(), nullable=False),
        sa.Column('devices', sa.Text(), nullable=False),
        sa.Column('assignment_ids', sa.Text(), nullable=False),
        sa.Column('draft_attachment_id', sa.Integer(), nullable=True),
        sa.Column('draft_url', sa.String(length=1000), nullable=True),
        sa.Column('signed_attachment_id', sa.Integer(), nullable=True),
        sa.Column('signed_url', sa.String(length=1000), nullable=True),
        sa.Column('status', sa.String(length=20), nullable=False, server_default='pending'),
        sa.Column('created_by', sa.String(length=100), nullable=True),
        sa.Column('signed_uploaded_by', sa.String(length=100), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('signed_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_handover_records_employee_contact_id', 'handover_records', ['employee_contact_id'])
    op.create_index('ix_handover_records_status', 'handover_records', ['status'])


def downgrade():
    op.drop_table('handover_records')
    op.drop_column('purchase_payments', 'netbox_device_ids')
