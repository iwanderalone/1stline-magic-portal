"""add grafana_alerts table

Revision ID: d4e5f6a7b8c0
Revises: c3d4e5f6a7b9
Branch labels: None
Depends on: None

"""
from alembic import op
import sqlalchemy as sa

revision = 'd4e5f6a7b8c0'
down_revision = 'c3d4e5f6a7b9'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'grafana_alerts',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('fingerprint', sa.String(64), nullable=False),
        sa.Column('status', sa.String(20), nullable=False),
        sa.Column('alertname', sa.String(200), nullable=True),
        sa.Column('severity', sa.String(50), nullable=True),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('labels', sa.Text(), nullable=True),
        sa.Column('generator_url', sa.String(500), nullable=True),
        sa.Column('fire_count', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('starts_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('ends_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('received_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('fingerprint', name='uq_grafana_alerts_fingerprint'),
    )
    op.create_index('ix_grafana_alerts_status', 'grafana_alerts', ['status'])
    op.create_index('ix_grafana_alerts_updated_at', 'grafana_alerts', ['updated_at'])


def downgrade():
    op.drop_index('ix_grafana_alerts_updated_at', table_name='grafana_alerts')
    op.drop_index('ix_grafana_alerts_status', table_name='grafana_alerts')
    op.drop_table('grafana_alerts')
