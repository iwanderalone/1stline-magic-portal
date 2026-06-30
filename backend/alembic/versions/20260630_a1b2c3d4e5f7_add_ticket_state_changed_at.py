"""add state_changed_at to zammad_tickets (time-in-status)

Revision ID: a1b2c3d4e5f7
Revises: f7a8b9c0d1e2
Branch labels: None
Depends on: None

"""
from alembic import op
import sqlalchemy as sa

revision = 'a1b2c3d4e5f7'
down_revision = 'f7a8b9c0d1e2'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('zammad_tickets', sa.Column('state_changed_at', sa.DateTime(timezone=True), nullable=True))
    # Seed existing rows so time-in-status has a sensible starting point.
    op.execute(
        "UPDATE zammad_tickets "
        "SET state_changed_at = COALESCE(zammad_updated_at, last_event_at, created_at) "
        "WHERE state_changed_at IS NULL"
    )


def downgrade():
    op.drop_column('zammad_tickets', 'state_changed_at')
