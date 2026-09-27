"""Who a manual change displaced, kept on the slot by identity.

A republish carries a hand-made change across only when the new draft gives
the slot back to the person the change displaced. That person used to be read
from the audit trail by display name, which a rename breaks and which kept
override entries out of retention for ever. The slot now keeps the origin
itself: the member's id, and the name as a label and as the identity of rows
without an id.

The backfill copies what the trail still holds, the first recorded move for
each slot changed by hand, and takes the id of the one team member who has
that name today. A name nobody has any longer, or that two members share,
stays a name alone, which is how every origin compared before.

Revision ID: 0036_assignment_override_origin
Revises: 0035_outbox_created_index
"""

import sqlalchemy as sa
from alembic import op

revision = "0036_assignment_override_origin"
down_revision = "0035_outbox_created_index"
branch_labels = None
depends_on = None

ORIGIN_ACTIONS = ("schedule.override", "schedule.override_batch", "schedule.draft_override")

audit_events = sa.table(
    "audit_events",
    sa.column("id", sa.Uuid()),
    sa.column("occurred_at", sa.DateTime(timezone=True)),
    sa.column("action", sa.String()),
    sa.column("entity_type", sa.String()),
    sa.column("entity_id", sa.String()),
    sa.column("summary", sa.String()),
    sa.column("details", sa.JSON()),
)
assignments = sa.table(
    "assignments",
    sa.column("id", sa.Uuid()),
    sa.column("schedule_id", sa.Uuid()),
    sa.column("service_date", sa.Date()),
    sa.column("role", sa.String()),
    sa.column("is_override", sa.Boolean()),
    sa.column("original_member_id", sa.Uuid()),
    sa.column("original_assignee_name", sa.String()),
)
team_members = sa.table(
    "team_members",
    sa.column("id", sa.Uuid()),
    sa.column("display_name", sa.String()),
)


def _moves(summary: str, details: dict | None) -> list[tuple[str, str, str]]:
    """(service date, role, previous name) for each slot one entry changed.

    Entries written before `details["moves"]` existed name one slot in
    `details` and the previous holder in the summary, "...: <old> → <new>".
    """
    details = details or {}
    moves = details.get("moves")
    if moves is None:
        try:
            previous = summary.split(": ", 1)[1].split(" → ", 1)[0]
            return [(str(details["service_date"]), str(details["role"]), previous)]
        except KeyError, IndexError:
            return []
    found = []
    for move in moves:
        try:
            found.append(
                (str(move["service_date"]), str(move["role"]), str(move["previous_assignee_name"]))
            )
        except KeyError, TypeError:
            continue
    return found


def _backfill() -> None:
    bind = op.get_bind()
    members_by_name: dict[str, list] = {}
    for member_id, name in bind.execute(sa.select(team_members.c.id, team_members.c.display_name)):
        members_by_name.setdefault(name, []).append(member_id)
    targets = {
        (str(row.schedule_id), row.service_date.isoformat(), row.role): row.id
        for row in bind.execute(
            sa.select(
                assignments.c.id,
                assignments.c.schedule_id,
                assignments.c.service_date,
                assignments.c.role,
            ).where(assignments.c.is_override.is_(True))
        )
    }
    if not targets:
        return
    origins: dict = {}
    events = bind.execute(
        sa.select(audit_events.c.entity_id, audit_events.c.summary, audit_events.c.details)
        .where(
            audit_events.c.entity_type == "schedule",
            audit_events.c.action.in_(ORIGIN_ACTIONS),
        )
        .order_by(audit_events.c.occurred_at, audit_events.c.id)
    )
    for entity_id, summary, details in events:
        for service_date, role, previous in _moves(summary, details):
            assignment_id = targets.get((entity_id, service_date, role))
            if assignment_id is not None:
                origins.setdefault(assignment_id, previous)
    for assignment_id, name in origins.items():
        namesakes = members_by_name.get(name, [])
        bind.execute(
            assignments.update()
            .where(assignments.c.id == assignment_id)
            .values(
                original_member_id=namesakes[0] if len(namesakes) == 1 else None,
                original_assignee_name=name[:160],
            )
        )


def upgrade() -> None:
    op.add_column("assignments", sa.Column("original_member_id", sa.Uuid(), nullable=True))
    op.add_column(
        "assignments", sa.Column("original_assignee_name", sa.String(length=160), nullable=True)
    )
    op.create_foreign_key(
        "fk_assignment_original_member",
        "assignments",
        "team_members",
        ["original_member_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_assignment_original_member", "assignments", ["original_member_id"])
    _backfill()


def downgrade() -> None:
    op.drop_index("ix_assignment_original_member", table_name="assignments")
    op.drop_constraint("fk_assignment_original_member", "assignments", type_="foreignkey")
    op.drop_column("assignments", "original_assignee_name")
    op.drop_column("assignments", "original_member_id")
