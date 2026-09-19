"""Persist structured schedule-run conflicts.

Revision ID: 0021_run_conflicts
Revises: 0020_drop_holiday_calendars
"""

import sqlalchemy as sa
from alembic import op

revision = "0021_run_conflicts"
down_revision = "0020_drop_holiday_calendars"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("schedule_runs", sa.Column("conflicts", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("schedule_runs", "conflicts")
