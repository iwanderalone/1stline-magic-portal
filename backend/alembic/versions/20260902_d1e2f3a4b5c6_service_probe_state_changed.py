"""add service_probes.state_changed_at (how long a target has been in its state)

Revision ID: d1e2f3a4b5c6
Revises: c9d0e1f2a3b4
Branch labels: None
Depends on: None

"""
from alembic import op
import sqlalchemy as sa

revision = 'd1e2f3a4b5c6'
down_revision = 'c9d0e1f2a3b4'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('service_probes', sa.Column('state_changed_at', sa.DateTime(timezone=True), nullable=True))
    # Seed existing rows so the UI has something to show before the next flip.
    op.execute('UPDATE service_probes SET state_changed_at = sample_at WHERE state_changed_at IS NULL')


def downgrade():
    op.drop_column('service_probes', 'state_changed_at')
