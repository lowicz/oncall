"""Record the rotation mode used for each generated schedule."""

import sqlalchemy as sa
from alembic import op

revision = "0004_schedule_rotation_mode"
down_revision = "0003_scheduling_policy"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("schedules", sa.Column("rotation_mode", sa.String(length=6), nullable=True))


def downgrade() -> None:
    op.drop_column("schedules", "rotation_mode")
