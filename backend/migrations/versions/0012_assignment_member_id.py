"""Tie an assignment to a team member by id, not by display name.

`assignee_name` was the only link between a duty and a person, so renaming
somebody silently detached them from their whole history: the balance, the
monthly report, their calendar feed and the swap flow all matched on the string.
The name stays as a historical label - imported CSV rows may name people who
were never accounts - but the id is the identity from here on.
"""

import sqlalchemy as sa
from alembic import op

revision = "0012_assignment_member_id"
down_revision = "0011_schedule_created_at"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "assignments",
        sa.Column("member_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_assignment_member",
        "assignments",
        "team_members",
        ["member_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_assignment_member", "assignments", ["member_id"])
    # Backfill by the only link that existed. Rows naming somebody who is not a
    # team member (historical imports) keep a null id and stay matched by name.
    op.execute(
        """
        UPDATE assignments
        SET member_id = tm.id
        FROM team_members AS tm
        WHERE tm.display_name = assignments.assignee_name
          AND assignments.member_id IS NULL
        """
    )


def downgrade() -> None:
    op.drop_index("ix_assignment_member", table_name="assignments")
    op.drop_constraint("fk_assignment_member", "assignments", type_="foreignkey")
    op.drop_column("assignments", "member_id")
