"""Names sort the Polish way.

The database's default collation compares code points on the Alpine image,
so a name starting with Ł, Ś or Ż, or with a lower-case letter, came last in
the monthly report and every other list the database orders. The columns
people read in sorted lists take ICU's Polish collation; the index on the
member name is rebuilt with it. Equality is unchanged: the collation is
deterministic.

A server built without ICU has no such collation; the columns then keep the
default with a warning, and only the order differs.

Revision ID: 0039_polish_name_collation
Revises: 0038_integrity_constraints
"""

import logging

import sqlalchemy as sa
from alembic import op

revision = "0039_polish_name_collation"
down_revision = "0038_integrity_constraints"
branch_labels = None
depends_on = None

log = logging.getLogger("alembic.runtime.migration")

COLLATION = "pl-PL-x-icu"
NAME_COLUMNS = (
    ("team_members", "display_name", 160),
    ("users", "first_name", 120),
    ("users", "last_name", 120),
    ("calendar_events", "title", 160),
)


def _collate(collation: str) -> None:
    for table, column, length in NAME_COLUMNS:
        op.execute(
            f"ALTER TABLE {table} ALTER COLUMN {column} "
            f'TYPE varchar({length}) COLLATE "{collation}"'
        )


def upgrade() -> None:
    available = op.get_bind().scalar(
        sa.text("SELECT 1 FROM pg_collation WHERE collname = :name"), {"name": COLLATION}
    )
    if not available:
        log.warning("This PostgreSQL has no %s collation; names keep the default order.", COLLATION)
        return
    _collate(COLLATION)


def downgrade() -> None:
    _collate("default")
