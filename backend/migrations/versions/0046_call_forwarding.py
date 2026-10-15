"""The settings and the state of forwarding the on-call number through WCO.

Two tables of one row each: the WCO account an administrator configures,
with its password stored as a Fernet token, and where forwarding stands as
the forwarding pass leaves it. Forwarding starts off.

Revision ID: 0046_call_forwarding
Revises: 0045_phone_e164
"""

import sqlalchemy as sa
from alembic import op

revision = "0046_call_forwarding"
down_revision = "0045_phone_e164"
branch_labels = None
depends_on = None


def _singleton(table: str) -> list[sa.SchemaItem]:
    return [
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("singleton", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.CheckConstraint("singleton", name=f"ck_{table}_singleton"),
        sa.UniqueConstraint("singleton", name=f"uq_{table}_singleton"),
    ]


def upgrade() -> None:
    op.create_table(
        "call_forwarding_settings",
        *_singleton("call_forwarding_settings"),
        sa.Column(
            "mode",
            sa.Enum(
                "off",
                "dry_run",
                "live",
                name="ck_call_forwarding_settings_mode",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=False,
            server_default="off",
        ),
        sa.Column(
            "base_url", sa.String(200), nullable=False, server_default="https://wco.orange.pl"
        ),
        sa.Column("vpbx_number", sa.String(20), nullable=True),
        sa.Column("username", sa.String(120), nullable=True),
        sa.Column("wco_user_id", sa.String(40), nullable=True),
        sa.Column("password_ciphertext", sa.Text(), nullable=True),
        sa.Column("password_changed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("pending_password_ciphertext", sa.Text(), nullable=True),
        sa.Column("pending_since", sa.DateTime(timezone=True), nullable=True),
        sa.Column("credentials_invalid_since", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
    )
    op.create_table(
        "call_forwarding_state",
        *_singleton("call_forwarding_state"),
        sa.Column("applied_number", sa.String(32), nullable=True),
        sa.Column(
            "applied_member_id",
            sa.Uuid(),
            sa.ForeignKey("team_members.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("applied_member_name", sa.String(160), nullable=True),
        sa.Column("applied_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("desired_number", sa.String(32), nullable=True),
        sa.Column("desired_member_name", sa.String(160), nullable=True),
        sa.Column("desired_for_day", sa.Date(), nullable=True),
        sa.Column("last_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "last_outcome",
            sa.Enum(
                "applied",
                "unchanged",
                "failed",
                "skipped_no_primary",
                "skipped_no_phone",
                "dry_run",
                name="ck_call_forwarding_state_last_outcome",
                native_enum=False,
                create_constraint=True,
            ),
            nullable=True,
        ),
        sa.Column("last_error", sa.String(500), nullable=True),
        sa.Column("failing_since", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("next_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("lease_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("alerted_for", sa.String(160), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("call_forwarding_state")
    op.drop_table("call_forwarding_settings")
