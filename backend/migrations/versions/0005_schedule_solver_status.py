"""Record the CP-SAT result status on generated schedules."""

import sqlalchemy as sa
from alembic import op

revision = "0005_schedule_solver_status"
down_revision = "0004_schedule_rotation_mode"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("schedules", sa.Column("solver_status", sa.String(length=20), nullable=True))


def downgrade() -> None:
    op.drop_column("schedules", "solver_status")
