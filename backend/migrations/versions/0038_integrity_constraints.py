"""Integrity rules the application held alone, now held by the database.

Vocabularies, date ranges, the owner of a session and of a calendar feed,
the two people of a swap, the run progress, the lower-cased login, one
scheduling policy row, and no overlapping eligibility or availability
periods of one person.

Rows written before a rule existed must not stop an upgrade. Every check is
added NOT VALID, so it binds every write from now on, and then validated on
its own; a check the existing rows break stays NOT VALID with a warning in the
migration log naming it, and `ALTER TABLE ... VALIDATE CONSTRAINT ...` finishes
it once the rows are corrected. An exclusion constraint cannot be NOT VALID:
one the existing rows break is not created, again with a warning, and the use
cases keep holding that rule as they always have.

A second scheduling policy row made which one every reader got arbitrary. The
most recently updated row is kept, the one an administrator saved last.

Revision ID: 0038_integrity_constraints
Revises: 0037_schedule_origin
"""

import logging

import sqlalchemy as sa
from alembic import op

revision = "0038_integrity_constraints"
down_revision = "0037_schedule_origin"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")

ROLES = ("primary", "secondary", "late_shift")


def _one_of(column: str, values: tuple[str, ...]) -> str:
    return f"{column} IN ({', '.join(repr(value) for value in values)})"


CHECKS = (
    ("schedules", "ck_schedules_range", "starts_on <= ends_on"),
    (
        "schedules",
        "ck_schedules_status",
        _one_of("status", ("draft", "proposed", "published", "superseded")),
    ),
    ("schedules", "ck_schedules_origin", _one_of("origin", ("generated", "imported"))),
    (
        "schedules",
        "ck_schedules_rotation_mode",
        _one_of("rotation_mode", ("hybrid", "daily", "weekly")),
    ),
    (
        "schedule_runs",
        "ck_schedule_runs_status",
        _one_of("status", ("queued", "running", "completed", "failed")),
    ),
    ("schedule_runs", "ck_schedule_runs_progress", "progress BETWEEN 0 AND 100"),
    ("schedule_runs", "ck_schedule_runs_range", "starts_on <= ends_on"),
    ("assignments", "ck_assignments_role", _one_of("role", ROLES)),
    (
        "scheduling_policies",
        "ck_scheduling_policies_rotation_mode",
        _one_of("rotation_mode", ("hybrid", "daily", "weekly")),
    ),
    (
        "scheduling_policies",
        "ck_scheduling_policies_late_shift_anchor",
        _one_of("late_shift_anchor", ("secondary", "primary", "independent")),
    ),
    ("scheduling_policies", "ck_scheduling_policies_singleton", "singleton"),
    (
        "swap_requests",
        "ck_swap_requests_two_people",
        "requester_member_id <> replacement_member_id",
    ),
    ("swap_requests", "ck_swap_requests_role", _one_of("role", ROLES)),
    (
        "swap_requests",
        "ck_swap_requests_status",
        _one_of(
            "status",
            ("pending_replacement", "pending_coordinator", "approved", "rejected", "cancelled"),
        ),
    ),
    ("swap_request_slots", "ck_swap_request_slots_role", _one_of("role", ROLES)),
    ("availability", "ck_availability_range", "starts_on <= ends_on"),
    (
        "availability",
        "ck_availability_kind",
        _one_of("kind", ("unavailable", "prefer_not", "prefer")),
    ),
    (
        "team_members",
        "ck_team_members_range",
        "active_until IS NULL OR active_from <= active_until",
    ),
    ("eligibility", "ck_eligibility_range", "ends_on IS NULL OR starts_on <= ends_on"),
    ("eligibility", "ck_eligibility_role", _one_of("role", ROLES)),
    ("calendar_events", "ck_calendar_events_range", "starts_on <= ends_on"),
    (
        "calendar_events",
        "ck_calendar_events_color",
        _one_of("color", ("blue", "green", "amber", "red", "violet", "teal")),
    ),
    ("share_links", "ck_share_links_range", "starts_on <= ends_on"),
    (
        "calendar_feed_tokens",
        "ck_calendar_feed_tokens_owner",
        "(kind = 'member' AND member_id IS NOT NULL AND share_link_id IS NULL)"
        " OR (kind = 'share_link' AND share_link_id IS NOT NULL AND member_id IS NULL)",
    ),
    (
        "calendar_feed_tokens",
        "ck_calendar_feed_tokens_kind",
        _one_of("kind", ("member", "share_link")),
    ),
    ("notification_outbox", "ck_notification_outbox_attempts", "attempts >= 0"),
    ("notification_outbox", "ck_notification_outbox_channel", _one_of("channel", ("email",))),
    (
        "notification_outbox",
        "ck_notification_outbox_status",
        _one_of("status", ("pending", "claimed", "sent", "failed", "skipped")),
    ),
    ("sessions", "ck_sessions_one_owner", "(user_id IS NULL) <> (share_link_id IS NULL)"),
    ("users", "ck_users_username_lower", "username = lower(username)"),
    ("users", "ck_users_auth_source", _one_of("auth_source", ("local", "ldap"))),
    (
        "users",
        "ck_users_role",
        _one_of("role", ("viewer", "member", "coordinator", "admin")),
    ),
    (
        "account_tokens",
        "ck_account_tokens_kind",
        _one_of("kind", ("activation", "password_reset")),
    ),
)

EXCLUSIONS = (
    (
        "eligibility",
        "ex_eligibility_no_overlap",
        "member_id WITH =, role WITH =, daterange(starts_on, ends_on, '[]') WITH &&",
    ),
    (
        "availability",
        "ex_availability_no_overlap",
        "member_id WITH =, daterange(starts_on, ends_on, '[]') WITH &&",
    ),
)


def _attempt(statement: str) -> str | None:
    """Run one statement in a savepoint; the database's refusal, if any."""
    bind = op.get_bind()
    try:
        with bind.begin_nested():
            bind.execute(sa.text(statement))
    except sa.exc.DBAPIError as error:
        # The driver's DETAIL names the conflicting key, which is how an
        # administrator finds the rows to correct.
        detail = getattr(error.orig.__cause__, "detail", None)
        message = str(error.orig).strip()
        return f"{message}: {detail}" if detail else message
    return None


def _one_policy_row() -> None:
    op.add_column(
        "scheduling_policies",
        sa.Column("singleton", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    removed = op.get_bind().execute(
        sa.text(
            "DELETE FROM scheduling_policies WHERE id <> ("
            "SELECT id FROM scheduling_policies ORDER BY updated_at DESC, id LIMIT 1)"
        )
    )
    if removed.rowcount:
        log.warning(
            "Removed %d extra scheduling policy rows; kept the one updated last.", removed.rowcount
        )
    op.create_unique_constraint(
        "uq_scheduling_policies_singleton", "scheduling_policies", ["singleton"]
    )


def upgrade() -> None:
    _one_policy_row()
    for table, name, condition in CHECKS:
        op.execute(f"ALTER TABLE {table} ADD CONSTRAINT {name} CHECK ({condition}) NOT VALID")
    for table, name, _ in CHECKS:
        refused = _attempt(f"ALTER TABLE {table} VALIDATE CONSTRAINT {name}")
        if refused is not None:
            log.warning(
                "%s.%s holds for new rows only: existing rows break it (%s). Correct them, "
                "then run ALTER TABLE %s VALIDATE CONSTRAINT %s.",
                table,
                name,
                refused,
                table,
                name,
            )
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")
    for table, name, elements in EXCLUSIONS:
        refused = _attempt(
            f"ALTER TABLE {table} ADD CONSTRAINT {name} EXCLUDE USING gist ({elements})"
        )
        if refused is not None:
            log.warning(
                "%s.%s not created: existing rows break it (%s). The application still "
                "refuses overlapping periods.",
                table,
                name,
                refused,
            )


def downgrade() -> None:
    for table, name, _ in EXCLUSIONS:
        op.execute(f"ALTER TABLE {table} DROP CONSTRAINT IF EXISTS {name}")
    for table, name, _ in reversed(CHECKS):
        op.execute(f"ALTER TABLE {table} DROP CONSTRAINT {name}")
    op.drop_constraint("uq_scheduling_policies_singleton", "scheduling_policies", type_="unique")
    op.drop_column("scheduling_policies", "singleton")
