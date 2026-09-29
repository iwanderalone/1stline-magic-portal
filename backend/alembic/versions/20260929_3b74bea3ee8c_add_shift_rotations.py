"""shift rotations: recurring assignment patterns per shift type

Revision ID: 3b74bea3ee8c
Revises: f3a4b5c6d7e8
Branch labels: None
Depends on: None

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = '3b74bea3ee8c'
down_revision = 'f3a4b5c6d7e8'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()

    rotation_mode = postgresql.ENUM('sequence', 'team', name='rotationmode')
    rotation_mode.create(bind, checkfirst=True)

    # 'shifttype' already exists (created by the initial schema migration) —
    # create_type=False stops create_table from re-issuing CREATE TYPE for it.
    shift_type_existing = postgresql.ENUM('day', 'night', 'office', name='shifttype', create_type=False)

    op.create_table(
        'shift_rotations',
        sa.Column('id', sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column('shift_type', shift_type_existing, nullable=False),
        sa.Column('label', sa.String(length=100), nullable=True),
        sa.Column('mode', rotation_mode, nullable=False, server_default='sequence'),
        sa.Column('user_ids', sa.Text(), nullable=False),
        sa.Column('anchor_date', sa.Date(), nullable=False),
        sa.Column('weekdays', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=True, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade():
    op.drop_table('shift_rotations')
    postgresql.ENUM(name='rotationmode').drop(op.get_bind(), checkfirst=True)
