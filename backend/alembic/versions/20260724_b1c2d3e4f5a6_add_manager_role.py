"""add manager value to userrole enum

Revision ID: b1c2d3e4f5a6
Revises: a7b8c9d0e1f3
Branch labels: None
Depends on: None

"""
from alembic import op

revision = 'b1c2d3e4f5a6'
down_revision = 'a7b8c9d0e1f3'
branch_labels = None
depends_on = None


def upgrade():
    # Postgres allows ADD VALUE inside a transaction as of PG12+, as long as
    # the new value isn't used by a DML statement in that same transaction —
    # this migration only adds it, so it's safe on its own.
    op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'manager'")


def downgrade():
    # Postgres has no ALTER TYPE ... DROP VALUE — removing an enum value
    # requires recreating the type (and would fail if any row still uses
    # 'manager'). Not implemented; revert by hand if ever needed.
    pass
