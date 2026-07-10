"""comment edit/delete — updated_at on comments, user_id on zammad_comments

Revision ID: f6a7b8c9d0e2
Revises: e5f6a7b8c9d1
Branch labels: None
Depends on: None

"""
from alembic import op
import sqlalchemy as sa

revision = 'f6a7b8c9d0e2'
down_revision = 'e5f6a7b8c9d1'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('email_comments', sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column('zammad_comments', sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True))
    op.add_column(
        'zammad_comments',
        sa.Column('user_id', sa.Uuid(), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
    )


def downgrade():
    op.drop_column('zammad_comments', 'user_id')
    op.drop_column('zammad_comments', 'updated_at')
    op.drop_column('email_comments', 'updated_at')
