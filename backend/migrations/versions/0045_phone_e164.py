"""Stored phone numbers take the Polish E.164 form.

The number is what the call forwarding sends to the switchboard, so a stored
value is `+48` and nine digits from now on: nine bare digits get the prefix,
`48` and nine digits the plus. Anything else stays as it is for the screens to
flag, which is why the column carries no check constraint.

Revision ID: 0045_phone_e164
Revises: 0044_swap_slot_direction
"""

from alembic import op

revision = "0045_phone_e164"
down_revision = "0044_swap_slot_direction"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(r"UPDATE users SET phone = '+48' || phone WHERE phone ~ '^[0-9]{9}$'")
    op.execute(r"UPDATE users SET phone = '+' || phone WHERE phone ~ '^48[0-9]{9}$'")


def downgrade() -> None:
    # The earlier rule accepts the E.164 form as well, so nothing to undo.
    pass
