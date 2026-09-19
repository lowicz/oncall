"""Persist the solver's acceptance floor on the schedule.

Revision ID: 0023_schedule_acceptance_floor
Revises: 0022_scheduling_weight_defaults
"""

import sqlalchemy as sa
from alembic import op

revision = "0023_schedule_acceptance_floor"
down_revision = "0022_scheduling_weight_defaults"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("schedules", sa.Column("acceptance_floor", sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column("schedules", "acceptance_floor")
