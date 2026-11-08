"""Number handovers: the day's PRIMARY lets the SECONDARY take the on-call
number until a time within the duty day.

At most one handover a day is open (`ended_at IS NULL`), held by a partial
unique index on PostgreSQL. Why one ended is a fixed vocabulary.

Revision ID: 0048_forwarding_handovers
Revises: 0047_notification_undo_window
"""

import sqlalchemy as sa
from alembic import op

revision = "0048_forwarding_handovers"
down_revision = "0047_notification_undo_window"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "forwarding_handovers",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("day", sa.Date(), nullable=False),
        sa.Column(
            "from_member_id",
            sa.Uuid(),
            sa.ForeignKey("team_members.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "to_member_id",
            sa.Uuid(),
            sa.ForeignKey("team_members.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("until", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_by_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "ended_by_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "end_reason",
            sa.Enum(
                "manual",
                "expired",
                "roster_change",
                name="ck_forwarding_handovers_end_reason",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=True,
        ),
        sa.CheckConstraint("starts_at < until", name="ck_forwarding_handovers_period"),
        sa.CheckConstraint(
            "(ended_at IS NULL) = (end_reason IS NULL)", name="ck_forwarding_handovers_end"
        ),
    )
    if op.get_bind().dialect.name == "postgresql":
        op.create_index(
            "uq_forwarding_handovers_open_day",
            "forwarding_handovers",
            ["day"],
            unique=True,
            postgresql_where=sa.text("ended_at IS NULL"),
        )


def downgrade() -> None:
    op.drop_table("forwarding_handovers")
