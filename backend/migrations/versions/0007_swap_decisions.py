"""Add swap rejection and cancellation details."""

import sqlalchemy as sa
from alembic import op

revision = "0007_swap_decisions"
down_revision = "0006_swap_requests"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "swap_requests",
        sa.Column("decision_note", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("swap_requests", "decision_note")
