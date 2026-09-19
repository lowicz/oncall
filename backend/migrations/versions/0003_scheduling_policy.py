"""Add configurable scheduling policy."""

import uuid
from datetime import UTC, datetime

import sqlalchemy as sa
from alembic import op

revision = "0003_scheduling_policy"
down_revision = "0002_team_availability"
branch_labels = None
depends_on = None


def upgrade() -> None:
    policy = op.create_table(
        "scheduling_policies",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("rotation_mode", sa.String(length=6), nullable=False),
        sa.Column("fairness_weight", sa.Float(), nullable=False),
        sa.Column("continuity_weight", sa.Float(), nullable=False),
        sa.Column("preference_weight", sa.Float(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.bulk_insert(
        policy,
        [
            {
                "id": uuid.UUID("00000000-0000-0000-0000-000000000001"),
                "rotation_mode": "hybrid",
                "fairness_weight": 1.0,
                "continuity_weight": 2.0,
                "preference_weight": 3.0,
                "updated_at": datetime.now(UTC),
            }
        ],
    )


def downgrade() -> None:
    op.drop_table("scheduling_policies")
