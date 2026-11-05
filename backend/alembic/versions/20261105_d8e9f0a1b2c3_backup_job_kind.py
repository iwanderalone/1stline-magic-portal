"""backup jobs: kind (mail|disk) and skipped-file count

Revision ID: d8e9f0a1b2c3
Revises: c7d1e2f3a4b5
Branch labels: None
Depends on: None

"""
from alembic import op
import sqlalchemy as sa

revision = 'd8e9f0a1b2c3'
down_revision = 'c7d1e2f3a4b5'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('mailbox_backup_jobs', sa.Column('kind', sa.String(length=10), nullable=False, server_default='mail'))
    op.add_column('mailbox_backup_jobs', sa.Column('skipped', sa.Integer(), nullable=True))


def downgrade():
    op.drop_column('mailbox_backup_jobs', 'skipped')
    op.drop_column('mailbox_backup_jobs', 'kind')
