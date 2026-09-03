"""mail routing rules: condition lists + per-rule Telegram notify list

Revision ID: f3a4b5c6d7e8
Revises: e2f3a4b5c6d7
Branch labels: None
Depends on: None

"""
from alembic import op
import sqlalchemy as sa

revision = 'f3a4b5c6d7e8'
down_revision = 'e2f3a4b5c6d7'
branch_labels = None
depends_on = None


def upgrade():
    # Existing rules keep working through match_type/match_values, which stay:
    # conditions is NULL for them and the matcher falls back.
    op.add_column('mail_routing_rules', sa.Column('conditions', sa.Text(), nullable=True))
    op.add_column('mail_routing_rules', sa.Column(
        'match_mode', sa.String(length=4), nullable=False, server_default='all'))
    op.add_column('mail_routing_rules', sa.Column('notify_user_ids', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('mail_routing_rules', 'notify_user_ids')
    op.drop_column('mail_routing_rules', 'match_mode')
    op.drop_column('mail_routing_rules', 'conditions')
