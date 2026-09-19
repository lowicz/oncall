"""Every slot a swap moves, as dependent rows.

A swap touched one slot while the 11-19 anchor binds two, so 0 of 28 `secondary`
and 0 of 20 `11-19` slots could be swapped under the default anchor (BLK6-01,
decision D1). A dependent table rather than a `paired_role` column so a later
range swap (PLAN.md par. 3) carries a week of slots without another migration.

Revision ID: 0027_swap_request_slots
Revises: 0026_availability_created_by
"""

import sqlalchemy as sa
from alembic import op

revision = "0027_swap_request_slots"
down_revision = "0026_availability_created_by"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "swap_request_slots",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("swap_request_id", sa.Uuid(), nullable=False),
        sa.Column("service_date", sa.Date(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.ForeignKeyConstraint(
            ["swap_request_id"], ["swap_requests.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "swap_request_id", "service_date", "role", name="uq_swap_request_slot"
        ),
    )
    op.create_index(
        "ix_swap_request_slots_swap_request_id",
        "swap_request_slots",
        ["swap_request_id"],
    )
    # Backfill: every existing request moves exactly the slot it was created with.
    op.execute(
        """
        INSERT INTO swap_request_slots (id, swap_request_id, service_date, role)
        SELECT gen_random_uuid(), id, service_date, role
        FROM swap_requests
        """
    )


def downgrade() -> None:
    op.drop_index("ix_swap_request_slots_swap_request_id", table_name="swap_request_slots")
    op.drop_table("swap_request_slots")
