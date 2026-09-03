"""add service_probes table (Prometheus remote_write status board)

Revision ID: c9d0e1f2a3b4
Revises: f5a6b7c8d9e0
Branch labels: None
Depends on: None

"""
from alembic import op
import sqlalchemy as sa

revision = 'c9d0e1f2a3b4'
down_revision = 'f5a6b7c8d9e0'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'service_probes',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('instance', sa.String(length=500), nullable=False),
        sa.Column('job', sa.String(length=200), nullable=True),
        sa.Column('labels', sa.Text(), nullable=True),
        sa.Column('up', sa.Boolean(), nullable=True),
        sa.Column('http_status', sa.Integer(), nullable=True),
        sa.Column('ssl_ok', sa.Boolean(), nullable=True),
        sa.Column('tls_version', sa.String(length=20), nullable=True),
        sa.Column('ssl_expiry_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('probe_duration', sa.Float(), nullable=True),
        sa.Column('dns_lookup', sa.Float(), nullable=True),
        sa.Column('ip_protocol', sa.String(length=10), nullable=True),
        sa.Column('sample_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.text('now()')),
        sa.UniqueConstraint('instance', name='uq_service_probes_instance'),
    )
    op.create_index('ix_service_probes_sample_at', 'service_probes', ['sample_at'])


def downgrade():
    op.drop_index('ix_service_probes_sample_at', table_name='service_probes')
    op.drop_table('service_probes')
