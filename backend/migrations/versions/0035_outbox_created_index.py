"""An index on the outbox's creation time, for retention.

The worker deletes finished outbox rows oldest first, by `created_at`; without
the index every batch is a sequential scan of the table plus a sort. The table
is small, so a plain CREATE INDEX inside the migration's transaction is fine.

Revision ID: 0035_outbox_created_index
Revises: 0034_policy_swap_approval
"""

from alembic import op

revision = "0035_outbox_created_index"
down_revision = "0034_policy_swap_approval"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_index("ix_notification_outbox_created", "notification_outbox", ["created_at"])


def downgrade() -> None:
    op.drop_index("ix_notification_outbox_created", table_name="notification_outbox")
