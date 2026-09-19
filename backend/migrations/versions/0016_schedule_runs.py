"""Add durable schedule generation queue.

Revision ID: 0016_schedule_runs
Revises: 0015_drop_late_shift_on_days_off
"""

import sqlalchemy as sa
from alembic import op

revision = "0016_schedule_runs"
down_revision = "0015_drop_late_shift_on_days_off"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "schedule_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=False),
        sa.Column("requested_by_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("schedule_id", sa.Uuid(), nullable=True),
        sa.Column("error", sa.String(500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["requested_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["schedule_id"], ["schedules.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_schedule_runs_status", "schedule_runs", ["status"])


def downgrade() -> None:
    op.drop_index("ix_schedule_runs_status", table_name="schedule_runs")
    op.drop_table("schedule_runs")
