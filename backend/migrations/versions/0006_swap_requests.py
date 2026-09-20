"""Add single-slot swap request workflow."""

import sqlalchemy as sa
from alembic import op

revision = "0006_swap_requests"
down_revision = "0005_schedule_solver_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "swap_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("schedule_id", sa.Uuid(), nullable=False),
        sa.Column("service_date", sa.Date(), nullable=False),
        sa.Column("role", sa.String(length=10), nullable=False),
        sa.Column("requester_member_id", sa.Uuid(), nullable=False),
        sa.Column("replacement_member_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=19), nullable=False),
        sa.Column("schedule_version", sa.Integer(), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["schedule_id"], ["schedules.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["requester_member_id"], ["team_members.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["replacement_member_id"], ["team_members.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_swap_requests_status", "swap_requests", ["status"])
    op.create_index(
        "ix_swap_requests_slot",
        "swap_requests",
        ["schedule_id", "service_date", "role"],
    )


def downgrade() -> None:
    op.drop_table("swap_requests")
