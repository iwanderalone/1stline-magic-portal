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
    # Deliberately no backfill: sample_at is when the target was last polled,
    # not when it went down, so seeding from it gives every existing row the
    # same invented outage start. NULL until the probe actually flips, and the
    # UI omits a duration it does not know.
    op.add_column('service_probes', sa.Column('state_changed_at', sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column('service_probes', 'state_changed_at')
