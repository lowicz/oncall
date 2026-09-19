"""Solver time budget as a policy field, not only an environment variable.

The UNKNOWN message already told the coordinator to raise the budget „w
ustawieniach generowania", where no such control existed (MED5-02).

Revision ID: 0025_policy_solve_seconds
Revises: 0024_schedule_solver_warnings
"""

import sqlalchemy as sa
from alembic import op

revision = "0025_policy_solve_seconds"
down_revision = "0024_schedule_solver_warnings"
branch_labels = None
depends_on = None

DEFAULT_SOLVE_SECONDS = "15.0"


def upgrade() -> None:
    op.add_column(
        "scheduling_policies",
        sa.Column(
            "solve_seconds",
            sa.Float(),
            nullable=False,
            server_default=sa.text(DEFAULT_SOLVE_SECONDS),
        ),
    )


def downgrade() -> None:
    op.drop_column("scheduling_policies", "solve_seconds")
