"""Add one-time account activation and password-reset tokens."""

import sqlalchemy as sa
from alembic import op

revision = "0014_account_tokens"
down_revision = "0013_user_identity"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "account_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_account_tokens_token_hash", "account_tokens", ["token_hash"], unique=True)
    op.create_index("ix_account_tokens_expires_at", "account_tokens", ["expires_at"])
    op.create_index("ix_account_tokens_user_kind", "account_tokens", ["user_id", "kind"])


def downgrade() -> None:
    op.drop_table("account_tokens")
