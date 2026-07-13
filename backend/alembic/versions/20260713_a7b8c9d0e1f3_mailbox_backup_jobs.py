"""mailbox_backup_jobs table (Tools → Mailbox Backup)

Revision ID: a7b8c9d0e1f3
Revises: f6a7b8c9d0e2
Branch labels: None
Depends on: None

"""
from alembic import op
import sqlalchemy as sa

revision = 'a7b8c9d0e1f3'
down_revision = 'f6a7b8c9d0e2'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'mailbox_backup_jobs',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('email', sa.String(320), nullable=False),
        sa.Column('requested_by', sa.String(100), nullable=False),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('phase', sa.String(30), nullable=True),
        sa.Column('folders_total', sa.Integer(), nullable=True),
        sa.Column('folders_done', sa.Integer(), nullable=True),
        sa.Column('messages_total', sa.Integer(), nullable=True),
        sa.Column('messages_done', sa.Integer(), nullable=True),
        sa.Column('current_folder', sa.String(255), nullable=True),
        sa.Column('archive_size', sa.BigInteger(), nullable=True),
        sa.Column('sha256', sa.String(64), nullable=True),
        sa.Column('s3_url', sa.String(1000), nullable=True),
        sa.Column('mbox_count', sa.Integer(), nullable=True),
        sa.Column('error', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_mailbox_backup_jobs_email', 'mailbox_backup_jobs', ['email'])


def downgrade():
    op.drop_index('ix_mailbox_backup_jobs_email', table_name='mailbox_backup_jobs')
    op.drop_table('mailbox_backup_jobs')
