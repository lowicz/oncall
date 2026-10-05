"""A swap slot knows its direction and its schedule.

A request may now name a duty of the replacement that the requester takes in
return. Every slot row therefore says which way it travels - `given` to the
replacement, as all existing rows are, or `returned` to the requester - and
which schedule holds it: the two days of an exchange may lie in different
publications, and a publication looks its swaps up by the slots it replaces.

Revision ID: 0044_swap_slot_direction
Revises: 0043_swap_rule_violations
"""

import sqlalchemy as sa
from alembic import op

revision = "0044_swap_slot_direction"
down_revision = "0043_swap_rule_violations"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "swap_request_slots",
        sa.Column(
            "direction",
            sa.Enum(
                "given",
                "returned",
                name="ck_swap_request_slots_direction",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
            server_default="given",
        ),
    )
    op.add_column("swap_request_slots", sa.Column("schedule_id", sa.Uuid(), nullable=True))
    op.execute(
        """
        UPDATE swap_request_slots
        SET schedule_id = swap_requests.schedule_id
        FROM swap_requests
        WHERE swap_requests.id = swap_request_slots.swap_request_id
        """
    )
    op.alter_column("swap_request_slots", "schedule_id", nullable=False)
    op.create_foreign_key(
        "swap_request_slots_schedule_id_fkey",
        "swap_request_slots",
        "schedules",
        ["schedule_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index("ix_swap_request_slots_schedule", "swap_request_slots", ["schedule_id"])


def downgrade() -> None:
    # The schema before this knows one direction only: a slot left behind
    # would read as one more duty the requester gives away.
    op.execute("DELETE FROM swap_request_slots WHERE direction = 'returned'")
    op.drop_index("ix_swap_request_slots_schedule", table_name="swap_request_slots")
    op.drop_constraint(
        "swap_request_slots_schedule_id_fkey", "swap_request_slots", type_="foreignkey"
    )
    op.drop_column("swap_request_slots", "schedule_id")
    op.drop_column("swap_request_slots", "direction")
