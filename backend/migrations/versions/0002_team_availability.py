"""Add team membership, eligibility and availability."""

import sqlalchemy as sa
from alembic import op

revision = "0002_team_availability"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "team_members",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=True),
        sa.Column("display_name", sa.String(length=160), nullable=False),
        sa.Column("active_from", sa.Date(), nullable=False),
        sa.Column("active_until", sa.Date(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )
    op.create_index("ix_team_members_display_name", "team_members", ["display_name"])
    op.create_table(
        "eligibility",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=10), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=True),
        sa.ForeignKeyConstraint(["member_id"], ["team_members.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("member_id", "role", "starts_on", name="uq_eligibility_period"),
    )
    op.create_index("ix_eligibility_member_id", "eligibility", ["member_id"])
    op.create_table(
        "availability",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("member_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=11), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=False),
        sa.Column("note", sa.String(length=500), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["member_id"], ["team_members.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_availability_member_dates", "availability", ["member_id", "starts_on", "ends_on"]
    )


def downgrade() -> None:
    op.drop_table("availability")
    op.drop_table("eligibility")
    op.drop_table("team_members")
