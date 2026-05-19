"""add zammad_events table

Revision ID: b3c4d5e6f7a8
Revises: a1b2c3d4e5f6
Branch labels: None
Depends on: None

"""
from alembic import op
import sqlalchemy as sa

revision = 'b3c4d5e6f7a8'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'zammad_events',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('event_type', sa.String(50), nullable=False),
        sa.Column('ticket_id', sa.Integer(), nullable=True),
        sa.Column('ticket_number', sa.String(20), nullable=True),
        sa.Column('ticket_title', sa.String(500), nullable=True),
        sa.Column('ticket_state', sa.String(50), nullable=True),
        sa.Column('ticket_group', sa.String(100), nullable=True),
        sa.Column('ticket_priority', sa.String(50), nullable=True),
        sa.Column('assignee', sa.String(150), nullable=True),
        sa.Column('customer', sa.String(255), nullable=True),
        sa.Column('article_body', sa.Text(), nullable=True),
        sa.Column('payload', sa.Text(), nullable=False),
        sa.Column('received_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_zammad_events_received_at', 'zammad_events', ['received_at'])
    op.create_index('ix_zammad_events_event_type', 'zammad_events', ['event_type'])
    op.create_index('ix_zammad_events_ticket_id', 'zammad_events', ['ticket_id'])


def downgrade():
    op.drop_index('ix_zammad_events_ticket_id', table_name='zammad_events')
    op.drop_index('ix_zammad_events_event_type', table_name='zammad_events')
    op.drop_index('ix_zammad_events_received_at', table_name='zammad_events')
    op.drop_table('zammad_events')
