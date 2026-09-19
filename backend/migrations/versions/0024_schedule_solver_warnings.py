"""Persist the solver's warnings on the schedule.

They used to live only in the run record and the audit log, so the
coordinator never saw that the spacing rules had been suspended (HGH5-06).

Revision ID: 0024_schedule_solver_warnings
Revises: 0023_schedule_acceptance_floor
"""

import sqlalchemy as sa
from alembic import op

revision = "0024_schedule_solver_warnings"
down_revision = "0023_schedule_acceptance_floor"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("schedules", sa.Column("solver_warnings", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("schedules", "solver_warnings")
