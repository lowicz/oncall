"""A member with swaps cannot be deleted.

Deleting a team member cascaded into every swap they asked for or took, and
swaps are part of the record of who was on duty. Nothing in the application
deletes a member - offboarding ends the membership and pseudonymises it - so
RESTRICT only states that intent where the database holds it.

Revision ID: 0042_swap_member_restrict
Revises: 0041_server_defaults
"""

from alembic import op

revision = "0042_swap_member_restrict"
down_revision = "0041_server_defaults"
branch_labels = None
depends_on = None

SIDES = ("requester_member_id", "replacement_member_id")


def _refer(ondelete: str) -> None:
    for column in SIDES:
        name = f"swap_requests_{column}_fkey"
        op.drop_constraint(name, "swap_requests", type_="foreignkey")
        op.create_foreign_key(
            name, "swap_requests", "team_members", [column], ["id"], ondelete=ondelete
        )


def upgrade() -> None:
    _refer("RESTRICT")


def downgrade() -> None:
    _refer("CASCADE")
