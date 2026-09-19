"""Track when a schedule was created, so drafts can be listed newest first."""

import sqlalchemy as sa
from alembic import op

revision = "0011_schedule_created_at"
down_revision = "0010_late_shift_anchor"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable: rows that predate this column simply have no recorded creation
    # time, which the listing renders as unknown rather than guessing one.
    op.add_column(
        "schedules",
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("schedules", "created_at")
