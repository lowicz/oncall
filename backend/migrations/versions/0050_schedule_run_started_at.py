"""When a generation run left the queue, so its screen can time the solve.

Null for a run still queued, and for runs claimed before this column existed.

Revision ID: 0050_schedule_run_started_at
Revises: 0049_availability_snapshots
"""

import sqlalchemy as sa
from alembic import op

revision = "0050_schedule_run_started_at"
down_revision = "0049_availability_snapshots"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "schedule_runs", sa.Column("started_at", sa.DateTime(timezone=True), nullable=True)
    )


def downgrade() -> None:
    op.drop_column("schedule_runs", "started_at")
