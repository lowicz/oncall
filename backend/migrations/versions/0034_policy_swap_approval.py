"""Whether a swap needs a coordinator's approval, as a policy field.

Every existing deployment keeps today's behaviour: the column comes up true.

Revision ID: 0034_policy_swap_approval
Revises: 0033_notification_html_body
"""

import sqlalchemy as sa
from alembic import op

revision = "0034_policy_swap_approval"
down_revision = "0033_notification_html_body"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "scheduling_policies",
        sa.Column(
            "coordinator_swap_approval_required",
            sa.Boolean(),
            nullable=False,
            server_default=sa.true(),
        ),
    )


def downgrade() -> None:
    op.drop_column("scheduling_policies", "coordinator_swap_approval_required")
