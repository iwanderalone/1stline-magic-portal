"""add email_replies table + email_logs.message_id (SMTP outbound)

Revision ID: e5f6a7b8c9d1
Revises: d4e5f6a7b8c0
Branch labels: None
Depends on: None

"""
from alembic import op
import sqlalchemy as sa

revision = 'e5f6a7b8c9d1'
down_revision = 'd4e5f6a7b8c0'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('email_logs', sa.Column('message_id', sa.String(500), nullable=True))
    op.create_table(
        'email_replies',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('email_id', sa.Integer(), sa.ForeignKey('email_logs.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('username', sa.String(100), nullable=True),
        sa.Column('to_addr', sa.String(500), nullable=False),
        sa.Column('subject', sa.String(500), nullable=False),
        sa.Column('body', sa.Text(), nullable=False),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_email_replies_email_id', 'email_replies', ['email_id'])


def downgrade():
    op.drop_index('ix_email_replies_email_id', table_name='email_replies')
    op.drop_table('email_replies')
    op.drop_column('email_logs', 'message_id')
