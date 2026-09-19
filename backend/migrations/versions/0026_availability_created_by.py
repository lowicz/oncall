"""Track who filed an availability entry, so coordinators can file on behalf.

The availability module was owner-only (`/availability/me`); a member on
holiday, ill, or without system access had no way to declare unavailability
(MED6-06). Coordinators now file it for them, and the member's screen has to
tell "I filed my holiday" apart from "a coordinator filed it for me".

Revision ID: 0026_availability_created_by
Revises: 0025_policy_solve_seconds
"""

import sqlalchemy as sa
from alembic import op

revision = "0026_availability_created_by"
down_revision = "0025_policy_solve_seconds"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "availability",
        sa.Column("created_by_user_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_availability_created_by_user",
        "availability",
        "users",
        ["created_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_availability_created_by_user", "availability", type_="foreignkey")
    op.drop_column("availability", "created_by_user_id")
