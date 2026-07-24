"""add sso_subject and sso_refresh_token_encrypted to users

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Branch labels: None
Depends on: None

"""
from alembic import op
import sqlalchemy as sa

revision = 'c2d3e4f5a6b7'
down_revision = 'b1c2d3e4f5a6'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('users', sa.Column('sso_subject', sa.String(255), nullable=True))
    op.add_column('users', sa.Column('sso_refresh_token_encrypted', sa.Text(), nullable=True))
    op.create_index('ix_users_sso_subject', 'users', ['sso_subject'], unique=True)


def downgrade():
    op.drop_index('ix_users_sso_subject', table_name='users')
    op.drop_column('users', 'sso_refresh_token_encrypted')
    op.drop_column('users', 'sso_subject')
