"""add zammad_tickets and zammad_comments tables

Revision ID: e6f7a8b9c0d1
Revises: d5e6f7a8b9c0
Branch labels: None
Depends on: None

"""
from alembic import op
import sqlalchemy as sa

revision = 'e6f7a8b9c0d1'
down_revision = 'd5e6f7a8b9c0'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'zammad_tickets',
        sa.Column('id', sa.Integer(), autoincrement=False, nullable=False),
        sa.Column('number', sa.String(20), nullable=True),
        sa.Column('title', sa.String(500), nullable=True),
        sa.Column('state', sa.String(50), nullable=True),
        sa.Column('group_name', sa.String(100), nullable=True),
        sa.Column('priority', sa.String(50), nullable=True),
        sa.Column('assignee', sa.String(150), nullable=True),
        sa.Column('customer', sa.String(255), nullable=True),
        sa.Column('article_count', sa.Integer(), nullable=True),
        sa.Column('last_comment', sa.Text(), nullable=True),
        sa.Column('last_event_type', sa.String(50), nullable=True),
        sa.Column('zammad_created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('zammad_updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_event_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_zammad_tickets_state', 'zammad_tickets', ['state'])
    op.create_index('ix_zammad_tickets_last_event_at', 'zammad_tickets', ['last_event_at'])

    op.create_table(
        'zammad_comments',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('article_id', sa.Integer(), nullable=True),
        sa.Column('ticket_id', sa.Integer(), nullable=False),
        sa.Column('author', sa.String(255), nullable=True),
        sa.Column('sender', sa.String(50), nullable=True),
        sa.Column('body', sa.Text(), nullable=True),
        sa.Column('internal', sa.Boolean(), nullable=True),
        sa.Column('zammad_created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('article_id', name='uq_zammad_comments_article_id'),
    )
    op.create_index('ix_zammad_comments_ticket_id', 'zammad_comments', ['ticket_id'])


def downgrade():
    op.drop_index('ix_zammad_comments_ticket_id', table_name='zammad_comments')
    op.drop_table('zammad_comments')
    op.drop_index('ix_zammad_tickets_last_event_at', table_name='zammad_tickets')
    op.drop_index('ix_zammad_tickets_state', table_name='zammad_tickets')
    op.drop_table('zammad_tickets')
