"""add pending_delete to shifts

Revision ID: d5e6f7a8b9c0
Revises: c4d5e6f7a8b9
Branch labels: None
Depends on: None

"""
from alembic import op
import sqlalchemy as sa

revision = 'd5e6f7a8b9c0'
down_revision = 'c4d5e6f7a8b9'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('shifts', sa.Column('pending_delete', sa.Boolean(), nullable=False, server_default='false'))


def downgrade():
    op.drop_column('shifts', 'pending_delete')
