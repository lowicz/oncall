"""A swap keeps the hard rules it broke knowingly.

A member may now ask for a swap that breaks a rest or anchor rule, as a
coordinator's correction may: the requester, the replacement and, where the
policy asks for one, a coordinator each acknowledge the violations. Audit
entries expire, so the acknowledged violations are kept on the request itself:
a list of `{rule, party, days}` naming each person by their side of the
request, null when the swap breaks nothing.

Revision ID: 0043_swap_rule_violations
Revises: 0042_swap_member_restrict
"""

import sqlalchemy as sa
from alembic import op

revision = "0043_swap_rule_violations"
down_revision = "0042_swap_member_restrict"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("swap_requests", sa.Column("rule_violations", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("swap_requests", "rule_violations")
