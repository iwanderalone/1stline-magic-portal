"""add email_logs.solved_by (who cleared the mail item)

Revision ID: e2f3a4b5c6d7
Revises: d1e2f3a4b5c6
Branch labels: None
Depends on: None

"""
from alembic import op
import sqlalchemy as sa

revision = 'e2f3a4b5c6d7'
down_revision = 'd1e2f3a4b5c6'
branch_labels = None
depends_on = None


def upgrade():
    # Nullable with no backfill: mail solved before this migration has no
    # recorded owner, so per-agent counts start from now.
    op.add_column('email_logs', sa.Column('solved_by', sa.String(length=100), nullable=True))


def downgrade():
    op.drop_column('email_logs', 'solved_by')
