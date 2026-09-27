"""Indexes that match the queries.

Two single-column indexes repeated the leading column of a unique constraint
on the same table and only cost writes. Four lookups had no index: whether a
slot already has a swap in progress, a member's swaps on either side, and an
account's sessions. The tables are small, so plain CREATE INDEX inside the
migration's transaction is enough.

Revision ID: 0040_index_tuning
Revises: 0039_polish_name_collation
"""

from alembic import op

revision = "0040_index_tuning"
down_revision = "0039_polish_name_collation"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index("ix_eligibility_member_id", table_name="eligibility")
    op.drop_index("ix_swap_request_slots_swap_request_id", table_name="swap_request_slots")
    op.create_index(
        "ix_swap_request_slots_day_role", "swap_request_slots", ["service_date", "role"]
    )
    op.create_index("ix_swap_requests_requester", "swap_requests", ["requester_member_id"])
    op.create_index("ix_swap_requests_replacement", "swap_requests", ["replacement_member_id"])
    op.create_index("ix_sessions_user_id", "sessions", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_sessions_user_id", table_name="sessions")
    op.drop_index("ix_swap_requests_replacement", table_name="swap_requests")
    op.drop_index("ix_swap_requests_requester", table_name="swap_requests")
    op.drop_index("ix_swap_request_slots_day_role", table_name="swap_request_slots")
    op.create_index(
        "ix_swap_request_slots_swap_request_id", "swap_request_slots", ["swap_request_id"]
    )
    op.create_index("ix_eligibility_member_id", "eligibility", ["member_id"])
