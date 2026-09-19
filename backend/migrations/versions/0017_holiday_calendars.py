"""Add versioned holiday calendars.

Revision ID: 0017_holiday_calendars
Revises: 0016_schedule_runs
"""

import sqlalchemy as sa
from alembic import op

revision = "0017_holiday_calendars"
down_revision = "0016_schedule_runs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "holiday_calendar_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("year", sa.Integer(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("holidays", sa.JSON(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=False),
        sa.Column("approved_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["approved_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("year", "version", name="uq_holiday_year_version"),
    )
    op.create_index("ix_holiday_calendar_versions_year", "holiday_calendar_versions", ["year"])
    op.create_index("ix_holiday_calendar_versions_status", "holiday_calendar_versions", ["status"])


def downgrade() -> None:
    op.drop_table("holiday_calendar_versions")
