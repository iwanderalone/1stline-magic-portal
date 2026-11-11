"""backup jobs: block / restore the Yandex 360 account after the backup

Revision ID: a3b4c5d6e7f8
Revises: f2a3b4c5d6e7
Branch labels: None
Depends on: None

"""
from alembic import op
import sqlalchemy as sa

revision = 'a3b4c5d6e7f8'
down_revision = 'f2a3b4c5d6e7'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('mailbox_backup_jobs', sa.Column('account_action', sa.String(length=10), nullable=True))
    op.add_column('mailbox_backup_jobs', sa.Column('account_result', sa.String(length=300), nullable=True))


def downgrade():
    op.drop_column('mailbox_backup_jobs', 'account_result')
    op.drop_column('mailbox_backup_jobs', 'account_action')
