"""Let schedule runs survive deletion of the requesting account.

Revision ID: 0018_runs_requester_set_null
Revises: 0017_holiday_calendars
"""

import sqlalchemy as sa
from alembic import op

revision = "0018_runs_requester_set_null"
down_revision = "0017_holiday_calendars"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("schedule_runs_requested_by_id_fkey", "schedule_runs", type_="foreignkey")
    op.alter_column("schedule_runs", "requested_by_id", existing_type=sa.Uuid(), nullable=True)
    op.create_foreign_key(
        "schedule_runs_requested_by_id_fkey",
        "schedule_runs",
        "users",
        ["requested_by_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("schedule_runs_requested_by_id_fkey", "schedule_runs", type_="foreignkey")
    op.execute("DELETE FROM schedule_runs WHERE requested_by_id IS NULL")
    op.alter_column("schedule_runs", "requested_by_id", existing_type=sa.Uuid(), nullable=False)
    op.create_foreign_key(
        "schedule_runs_requested_by_id_fkey",
        "schedule_runs",
        "users",
        ["requested_by_id"],
        ["id"],
    )
