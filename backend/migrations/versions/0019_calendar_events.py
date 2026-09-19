"""Add visual calendar events.

Revision ID: 0019_calendar_events
Revises: 0018_runs_requester_set_null
"""

import sqlalchemy as sa
from alembic import op

revision = "0019_calendar_events"
down_revision = "0018_runs_requester_set_null"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "calendar_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=False),
        sa.Column("title", sa.String(160), nullable=False),
        sa.Column("color", sa.String(12), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_calendar_events_starts_on", "calendar_events", ["starts_on"])
    op.create_index("ix_calendar_events_ends_on", "calendar_events", ["ends_on"])


def downgrade() -> None:
    op.drop_index("ix_calendar_events_ends_on", table_name="calendar_events")
    op.drop_index("ix_calendar_events_starts_on", table_name="calendar_events")
    op.drop_table("calendar_events")
