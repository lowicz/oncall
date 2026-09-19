"""Add configurable 11-19 anchor."""

import sqlalchemy as sa
from alembic import op

revision = "0010_late_shift_anchor"
down_revision = "0009_audit_events"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "scheduling_policies",
        sa.Column(
            "late_shift_anchor",
            sa.String(length=12),
            nullable=False,
            server_default="secondary",
        ),
    )


def downgrade() -> None:
    op.drop_column("scheduling_policies", "late_shift_anchor")
