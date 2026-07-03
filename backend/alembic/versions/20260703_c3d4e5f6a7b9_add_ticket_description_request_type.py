"""add description and request_type to zammad_tickets

Revision ID: c3d4e5f6a7b9
Revises: b2c3d4e5f6a8
Branch labels: None
Depends on: None

"""
from alembic import op
import sqlalchemy as sa

revision = 'c3d4e5f6a7b9'
down_revision = 'b2c3d4e5f6a8'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('zammad_tickets', sa.Column('request_type', sa.String(150), nullable=True))
    op.add_column('zammad_tickets', sa.Column('description', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('zammad_tickets', 'description')
    op.drop_column('zammad_tickets', 'request_type')
