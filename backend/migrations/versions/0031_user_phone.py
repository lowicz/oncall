"""Add an optional contact phone number to users.

Revision ID: 0031_user_phone
Revises: 0030_schedule_quality
"""

import sqlalchemy as sa
from alembic import op

revision = "0031_user_phone"
down_revision = "0030_schedule_quality"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("phone", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "phone")
