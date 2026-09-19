"""Store solver quality metadata.

Revision ID: 0030_schedule_quality
Revises: 0029_user_identity_ci
"""

import sqlalchemy as sa
from alembic import op

revision = "0030_schedule_quality"
down_revision = "0029_user_identity_ci"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "schedules",
        sa.Column("fairness_proven", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("schedules", sa.Column("continuity_gap", sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column("schedules", "continuity_gap")
    op.drop_column("schedules", "fairness_proven")
