"""Defaults the database applies itself.

The application fills every creation time, status, counter and flag in
Python, so the database accepted no row without them: a correction typed in
psql had to spell out `created_at`, `version` or `attempts`. The same values
now stand as server defaults. The application's own values are unchanged.

Revision ID: 0041_server_defaults
Revises: 0040_index_tuning
"""

from alembic import op

revision = "0041_server_defaults"
down_revision = "0040_index_tuning"
branch_labels = None
depends_on = None

DEFAULTS = (
    ("schedules", "created_at", "now()"),
    ("schedules", "version", "1"),
    ("schedule_runs", "status", "'queued'"),
    ("schedule_runs", "progress", "0"),
    ("schedule_runs", "created_at", "now()"),
    ("schedule_runs", "updated_at", "now()"),
    ("assignments", "is_override", "false"),
    ("scheduling_policies", "rotation_mode", "'hybrid'"),
    ("scheduling_policies", "fairness_weight", "3.0"),
    ("scheduling_policies", "continuity_weight", "1.0"),
    ("scheduling_policies", "preference_weight", "2.0"),
    ("scheduling_policies", "updated_at", "now()"),
    ("swap_requests", "created_at", "now()"),
    ("swap_requests", "updated_at", "now()"),
    ("availability", "created_at", "now()"),
    ("team_members", "created_at", "now()"),
    ("calendar_events", "created_at", "now()"),
    ("share_links", "created_at", "now()"),
    ("calendar_feed_tokens", "created_at", "now()"),
    ("notification_outbox", "status", "'pending'"),
    ("notification_outbox", "attempts", "0"),
    ("notification_outbox", "next_attempt_at", "now()"),
    ("notification_outbox", "created_at", "now()"),
    ("users", "is_active", "true"),
    ("users", "created_at", "now()"),
    ("account_tokens", "created_at", "now()"),
    ("sessions", "created_at", "now()"),
    ("audit_events", "occurred_at", "now()"),
)


def upgrade() -> None:
    for table, column, default in DEFAULTS:
        op.execute(f"ALTER TABLE {table} ALTER COLUMN {column} SET DEFAULT {default}")


def downgrade() -> None:
    for table, column, _ in DEFAULTS:
        op.execute(f"ALTER TABLE {table} ALTER COLUMN {column} DROP DEFAULT")
