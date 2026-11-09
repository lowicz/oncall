"""What a painted availability range held before the stroke, for its Undo.

One row per stroke sent with an `undo_id`; the Undo takes it, retention
deletes what is left a day later.

Revision ID: 0049_availability_snapshots
Revises: 0048_forwarding_handovers
"""

import sqlalchemy as sa
from alembic import op

revision = "0049_availability_snapshots"
down_revision = "0048_forwarding_handovers"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "availability_range_snapshots",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "member_id",
            sa.Uuid(),
            sa.ForeignKey("team_members.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "actor_user_id",
            sa.Uuid(),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=False),
        sa.Column("entries", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_availability_range_snapshots_created",
        "availability_range_snapshots",
        ["created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_availability_range_snapshots_created", table_name="availability_range_snapshots"
    )
    op.drop_table("availability_range_snapshots")
