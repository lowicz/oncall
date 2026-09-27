"""Where a schedule came from, as a column instead of a name prefix.

A history import was told from a real publication by its name starting with
"Import historii:", so a label decided which schedule wins a slot. Existing
imports are the retired schedules with that prefix; everything else was
generated.

Revision ID: 0037_schedule_origin
Revises: 0036_assignment_override_origin
"""

import sqlalchemy as sa
from alembic import op

revision = "0037_schedule_origin"
down_revision = "0036_assignment_override_origin"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "schedules",
        sa.Column(
            "origin",
            sa.Enum("generated", "imported", name="scheduleorigin", native_enum=False),
            nullable=False,
            server_default="generated",
        ),
    )
    op.execute(
        "UPDATE schedules SET origin = 'imported' "
        "WHERE status = 'superseded' AND name LIKE 'Import historii:%'"
    )


def downgrade() -> None:
    op.drop_column("schedules", "origin")
