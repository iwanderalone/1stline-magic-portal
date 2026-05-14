"""drop containers feature tables

Revision ID: a1b2c3d4e5f6
Revises: 7f3a8b9c1d2e
Create Date: 2026-05-08 18:00:00.000000

Removes the VPS/container monitoring feature: vps_agents, container_states,
container_commands. The Containers UI, /api/containers router, and Telegraf
agent code were deleted. No data is preserved — drop is destructive.
"""
from alembic import op


revision = 'a1b2c3d4e5f6'
down_revision = '7f3a8b9c1d2e'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_table('container_commands')
    op.drop_table('container_states')
    op.drop_table('vps_agents')
    if op.get_context().dialect.name == "postgresql":
        op.execute("DROP TYPE IF EXISTS containercommandtype")
        op.execute("DROP TYPE IF EXISTS containercommandstatus")


def downgrade():
    raise NotImplementedError(
        "Containers feature was deleted; downgrade would require restoring the "
        "full schema (vps_agents, container_states, container_commands) and is not supported."
    )
