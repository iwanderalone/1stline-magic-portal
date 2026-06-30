"""add portal_only flag to zammad_comments

Revision ID: f7a8b9c0d1e2
Revises: e6f7a8b9c0d1
Branch labels: None
Depends on: None

"""
from alembic import op
import sqlalchemy as sa

revision = 'f7a8b9c0d1e2'
down_revision = 'e6f7a8b9c0d1'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'zammad_comments',
        sa.Column('portal_only', sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade():
    op.drop_column('zammad_comments', 'portal_only')
