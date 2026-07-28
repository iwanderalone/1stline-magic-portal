"""add hr value to userrole enum

Revision ID: d3e4f5a6b7c8
Revises: c2d3e4f5a6b7
Branch labels: None
Depends on: None

"""
from alembic import op

revision = 'd3e4f5a6b7c8'
down_revision = 'c2d3e4f5a6b7'
branch_labels = None
depends_on = None


def upgrade():
    # Same constraint as the manager-role migration: ADD VALUE is safe inside
    # a transaction as long as nothing in the same transaction uses the new
    # value — this migration only adds it.
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'hr'")


def downgrade():
    # No ALTER TYPE ... DROP VALUE in Postgres — revert by hand if ever needed.
    pass
