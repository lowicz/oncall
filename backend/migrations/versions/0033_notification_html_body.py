"""Add the HTML rendering of a notification next to its plain text.

Rows enqueued before this column existed keep it empty and go out as plain
text only, exactly as they were composed.

Revision ID: 0033_notification_html_body
Revises: 0032_normalize_user_identity
"""

import sqlalchemy as sa
from alembic import op

revision = "0033_notification_html_body"
down_revision = "0032_normalize_user_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("notification_outbox", sa.Column("html_body", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("notification_outbox", "html_body")
