"""mail triage columns + IMAP UID cursor

Revision ID: c5d6e7f8a9b0
Revises: b4c5d6e7f8a9
Create Date: 2026-11-24
"""
from alembic import op
import sqlalchemy as sa

revision = "c5d6e7f8a9b0"
down_revision = "b4c5d6e7f8a9"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("email_logs", sa.Column("triage", sa.String(10), nullable=True))
    op.add_column("email_logs", sa.Column("triage_topic", sa.String(20), nullable=True))
    op.add_column("email_logs", sa.Column("triage_summary", sa.Text(), nullable=True))
    op.add_column("email_logs", sa.Column("triage_action", sa.Text(), nullable=True))
    op.add_column("email_logs", sa.Column("triage_feedback", sa.String(10), nullable=True))
    op.add_column("email_logs", sa.Column("digested_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_email_logs_triage", "email_logs", ["triage"])
    op.add_column("mailbox_configs", sa.Column("imap_uidvalidity", sa.BigInteger(), nullable=True))
    op.add_column("mailbox_configs", sa.Column("imap_last_uid", sa.BigInteger(), nullable=True))


def downgrade():
    op.drop_column("mailbox_configs", "imap_last_uid")
    op.drop_column("mailbox_configs", "imap_uidvalidity")
    op.drop_index("ix_email_logs_triage", table_name="email_logs")
    for col in ("digested_at", "triage_feedback", "triage_action", "triage_summary", "triage_topic", "triage"):
        op.drop_column("email_logs", col)
