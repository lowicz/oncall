"""Add notification outbox, calendar feed tokens, viewer share links and user email."""

import sqlalchemy as sa
from alembic import op

revision = "0008_notifications_sharing"
down_revision = "0007_swap_decisions"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("email", sa.String(length=320), nullable=True))

    op.create_table(
        "share_links",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("label", sa.String(length=160), nullable=False),
        sa.Column("starts_on", sa.Date(), nullable=False),
        sa.Column("ends_on", sa.Date(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_share_links_token_hash", "share_links", ["token_hash"], unique=True)

    op.create_table(
        "notification_outbox",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "channel",
            sa.Enum("email", name="notificationchannel", native_enum=False),
            nullable=False,
        ),
        sa.Column("recipient", sa.String(length=320), nullable=False),
        sa.Column("subject", sa.String(length=200), nullable=False),
        sa.Column("body", sa.Text(), nullable=False),
        sa.Column("context", sa.JSON(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "pending", "sent", "failed", "skipped",
                name="notificationstatus", native_enum=False,
            ),
            nullable=False,
        ),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_error", sa.String(length=500), nullable=True),
        sa.Column("dedup_key", sa.String(length=160), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_notification_outbox_pending",
        "notification_outbox",
        ["status", "next_attempt_at"],
    )
    op.create_unique_constraint(
        "uq_notification_outbox_dedup_key", "notification_outbox", ["dedup_key"]
    )

    op.create_table(
        "calendar_feed_tokens",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "kind",
            sa.Enum("member", "share_link", name="feedtokenkind", native_enum=False),
            nullable=False,
        ),
        sa.Column("label", sa.String(length=160), nullable=False),
        sa.Column(
            "member_id",
            sa.Uuid(),
            sa.ForeignKey("team_members.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column(
            "share_link_id",
            sa.Uuid(),
            sa.ForeignKey("share_links.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("created_by_id", sa.Uuid(), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_calendar_feed_tokens_token_hash",
        "calendar_feed_tokens",
        ["token_hash"],
        unique=True,
    )

    op.alter_column("sessions", "user_id", nullable=True)
    op.add_column("sessions", sa.Column("share_link_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_sessions_share_link_id",
        "sessions",
        "share_links",
        ["share_link_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("fk_sessions_share_link_id", "sessions", type_="foreignkey")
    op.drop_column("sessions", "share_link_id")
    op.alter_column("sessions", "user_id", nullable=False)
    op.drop_index("ix_calendar_feed_tokens_token_hash", table_name="calendar_feed_tokens")
    op.drop_table("calendar_feed_tokens")
    op.drop_constraint(
        "uq_notification_outbox_dedup_key", "notification_outbox", type_="unique"
    )
    op.drop_index("ix_notification_outbox_pending", table_name="notification_outbox")
    op.drop_table("notification_outbox")
    op.drop_index("ix_share_links_token_hash", table_name="share_links")
    op.drop_table("share_links")
    op.drop_column("users", "email")
