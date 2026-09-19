"""One active generation per date range.

Two coordinators queuing the same range produced two drafts nobody could tell
apart - same name, range, version, assignment count, creation time (MED6-05).
The route now hands back the run already in flight; this partial unique index is
the backstop for two requests that race past that check. It covers only
``queued`` and ``running`` rows, so finished runs of the same range still
coexist.

Postgres-only: the predicate uses ``status IN (...)``. SQLite test databases
rely on the check-then-insert guard in the route instead.

Revision ID: 0028_schedule_run_active_range
Revises: 0027_swap_request_slots
"""

import sqlalchemy as sa
from alembic import op

revision = "0028_schedule_run_active_range"
down_revision = "0027_swap_request_slots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index(
        "uq_schedule_run_active_range",
        "schedule_runs",
        ["starts_on", "ends_on"],
        unique=True,
        postgresql_where=sa.text("status IN ('queued', 'running')"),
    )


def downgrade() -> None:
    op.drop_index("uq_schedule_run_active_range", table_name="schedule_runs")
