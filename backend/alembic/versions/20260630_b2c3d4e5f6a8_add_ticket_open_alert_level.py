"""add open_alert_level to zammad_tickets (Telegram open-overdue escalation)

Revision ID: b2c3d4e5f6a8
Revises: a1b2c3d4e5f7
Branch labels: None
Depends on: None

"""
from alembic import op
import sqlalchemy as sa

revision = 'b2c3d4e5f6a8'
down_revision = 'a1b2c3d4e5f7'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('zammad_tickets', sa.Column('open_alert_level', sa.Integer(), nullable=False, server_default='0'))
    # Suppress retroactive escalation alerts for the existing open backlog: mark
    # them as already at the top escalation level so the worker won't fire on deploy.
    op.execute("UPDATE zammad_tickets SET open_alert_level = 3")


def downgrade():
    op.drop_column('zammad_tickets', 'open_alert_level')
