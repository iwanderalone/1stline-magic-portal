"""backfill and enforce not-null runbook timestamps

A runbook row with NULL created_at/updated_at made the entire
GET /api/runbooks/ list 500 (RunbookResponse requires a datetime),
breaking runbook search everywhere it's used (command palette, etc).
The columns had a Python-side ORM default but no NOT NULL/server
default, so nothing stopped a row from being inserted with them unset.

Revision ID: e4f5a6b7c8d9
Revises: d3e4f5a6b7c8
Branch labels: None
Depends on: None

"""
from alembic import op

revision = 'e4f5a6b7c8d9'
down_revision = 'd3e4f5a6b7c8'
branch_labels = None
depends_on = None


def upgrade():
    op.execute("UPDATE runbooks SET created_at = now() WHERE created_at IS NULL")
    op.execute("UPDATE runbooks SET updated_at = now() WHERE updated_at IS NULL")
    op.execute("ALTER TABLE runbooks ALTER COLUMN created_at SET DEFAULT now()")
    op.execute("ALTER TABLE runbooks ALTER COLUMN updated_at SET DEFAULT now()")
    op.execute("ALTER TABLE runbooks ALTER COLUMN created_at SET NOT NULL")
    op.execute("ALTER TABLE runbooks ALTER COLUMN updated_at SET NOT NULL")


def downgrade():
    op.execute("ALTER TABLE runbooks ALTER COLUMN created_at DROP NOT NULL")
    op.execute("ALTER TABLE runbooks ALTER COLUMN updated_at DROP NOT NULL")
    op.execute("ALTER TABLE runbooks ALTER COLUMN created_at DROP DEFAULT")
    op.execute("ALTER TABLE runbooks ALTER COLUMN updated_at DROP DEFAULT")
