"""Drop 11-19 shifts placed on days off in schedules that are not published yet.

The rule is that the 11-19 shift exists only on Polish working days. Drafts and
proposals generated before that rule was enforced still carry Saturday, Sunday
and holiday rows, and those rows fail publication validation. Published and
superseded schedules are left alone: they are the record of what was actually
worked, and the read path now refuses to resolve those slots anyway.
"""

import holidays as country_holidays
import sqlalchemy as sa
from alembic import op

revision = "0015_drop_late_shift_on_days_off"
down_revision = "0014_account_tokens"
branch_labels = None
depends_on = None

STALE = sa.text(
    "SELECT a.id AS id, a.service_date AS service_date FROM assignments a "
    "JOIN schedules s ON s.id = a.schedule_id "
    "WHERE a.role = 'late_shift' AND s.status IN ('draft', 'proposed')"
)


def upgrade() -> None:
    connection = op.get_bind()
    rows = connection.execute(STALE).all()
    if not rows:
        return
    polish_days = set(
        country_holidays.country_holidays(
            "PL", years=sorted({row.service_date.year for row in rows})
        )
    )
    stale = [
        row.id for row in rows if row.service_date.weekday() >= 5 or row.service_date in polish_days
    ]
    if not stale:
        return
    connection.execute(
        sa.text("DELETE FROM assignments WHERE id IN :ids").bindparams(
            sa.bindparam("ids", expanding=True)
        ),
        {"ids": stale},
    )


def downgrade() -> None:
    """Deleted duty rows are not reconstructible; the rule stands either way."""
