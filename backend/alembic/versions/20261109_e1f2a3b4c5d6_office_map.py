"""office map: floor plans + desks/rooms/racks bound to NetBox locations

Revision ID: e1f2a3b4c5d6
Revises: d8e9f0a1b2c3
Branch labels: None
Depends on: None

"""
from alembic import op
import sqlalchemy as sa

revision = 'e1f2a3b4c5d6'
down_revision = 'd8e9f0a1b2c3'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'office_map_areas',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('slug', sa.String(length=50), nullable=False, unique=True),
        sa.Column('name', sa.String(length=100), nullable=False),
        sa.Column('sort', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('width', sa.Integer(), nullable=False),
        sa.Column('height', sa.Integer(), nullable=False),
        sa.Column('walls', sa.Text(), nullable=False, server_default='[]'),
        sa.Column('labels', sa.Text(), nullable=False, server_default='[]'),
        sa.Column('zones', sa.Text(), nullable=False, server_default='[]'),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        'office_map_items',
        sa.Column('id', sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column('area_id', sa.Integer(), sa.ForeignKey('office_map_areas.id', ondelete='CASCADE'), nullable=False),
        sa.Column('kind', sa.String(length=20), nullable=False),
        sa.Column('label', sa.String(length=100), nullable=True),
        sa.Column('netbox_location_id', sa.Integer(), nullable=True, unique=True),
        sa.Column('netbox_rack_id', sa.Integer(), nullable=True),
        sa.Column('x', sa.Float(), nullable=False),
        sa.Column('y', sa.Float(), nullable=False),
        sa.Column('w', sa.Float(), nullable=False),
        sa.Column('h', sa.Float(), nullable=False),
        sa.Column('note', sa.String(length=300), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_office_map_items_area_id', 'office_map_items', ['area_id'])


def downgrade():
    op.drop_index('ix_office_map_items_area_id', table_name='office_map_items')
    op.drop_table('office_map_items')
    op.drop_table('office_map_areas')
