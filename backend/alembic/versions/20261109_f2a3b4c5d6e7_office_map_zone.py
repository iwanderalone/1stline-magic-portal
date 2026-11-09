"""office map items: zone (the desk group a card is built from)

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Branch labels: None
Depends on: None

"""
from alembic import op
import sqlalchemy as sa

revision = 'f2a3b4c5d6e7'
down_revision = 'e1f2a3b4c5d6'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('office_map_items', sa.Column('zone', sa.String(length=100), nullable=True))


def downgrade():
    op.drop_column('office_map_items', 'zone')
