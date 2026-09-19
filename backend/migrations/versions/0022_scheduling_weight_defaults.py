"""Apply normalized scheduling weight defaults.

Revision ID: 0022_scheduling_weight_defaults
Revises: 0021_run_conflicts
"""

import sqlalchemy as sa
from alembic import op

revision = "0022_scheduling_weight_defaults"
down_revision = "0021_run_conflicts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE scheduling_policies SET fairness_weight = 3.0, "
            "continuity_weight = 1.0, preference_weight = 2.0"
        )
    )


def downgrade() -> None:
    op.execute(
        sa.text(
            "UPDATE scheduling_policies SET fairness_weight = 1.0, "
            "continuity_weight = 2.0, preference_weight = 3.0"
        )
    )
