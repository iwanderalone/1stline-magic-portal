"""add user_blocked_dates table

Revision ID: c4d5e6f7a8b9
Revises: b3c4d5e6f7a8
Branch labels: None
Depends on: None

"""
from alembic import op
import sqlalchemy as sa

revision = 'c4d5e6f7a8b9'
down_revision = 'b3c4d5e6f7a8'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'user_blocked_dates',
        sa.Column('id', sa.Uuid(), nullable=False),
        sa.Column('user_id', sa.Uuid(), nullable=False),
        sa.Column('start_date', sa.Date(), nullable=False),
        sa.Column('end_date', sa.Date(), nullable=False),
        sa.Column('reason', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_user_blocked_dates_user_id', 'user_blocked_dates', ['user_id'])


def downgrade():
    op.drop_index('ix_user_blocked_dates_user_id', table_name='user_blocked_dates')
    op.drop_table('user_blocked_dates')
