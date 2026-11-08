"""Delay reversible notifications until their Undo window closes.

`send_after` is where the Undo window closes; a new row's `next_attempt_at`
starts there, so the worker cannot claim it earlier. `cancelled_at` keeps an
undone message for the ordinary outbox retention period while ensuring no
worker claims it.

Revision ID: 0047_notification_undo_window
Revises: 0046_call_forwarding
"""

import sqlalchemy as sa
from alembic import op

revision = "0047_notification_undo_window"
down_revision = "0046_call_forwarding"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "notification_outbox",
        sa.Column(
            "send_after",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
    )
    op.add_column(
        "notification_outbox",
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("notification_outbox", "cancelled_at")
    op.drop_column("notification_outbox", "send_after")
