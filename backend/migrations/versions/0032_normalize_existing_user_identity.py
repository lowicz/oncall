"""Normalize existing usernames and e-mails to lower case.

0029 added a case-insensitive uniqueness constraint but never touched rows
that predate it: an account created before that migration with a mixed-case
username (or e-mail) kept it, and login compares the normalized input
against the stored value exactly, so `Review.E3` and `review.e3` disagreed
about the same account (QA7 par. 8, E2 review).

Safe by construction: 0029 already proved no two rows share the same
`lower(username)`/`lower(email)`, so lower-casing a row here cannot collide
with any other row, only (harmlessly) with itself.

Revision ID: 0032_normalize_user_identity
Revises: 0031_user_phone
"""

from alembic import op

revision = "0032_normalize_user_identity"
down_revision = "0031_user_phone"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("UPDATE users SET username = lower(username) WHERE username <> lower(username)")
    op.execute(
        "UPDATE users SET email = lower(email) WHERE email IS NOT NULL AND email <> lower(email)"
    )


def downgrade() -> None:
    # Case is not recoverable once lower-cased; nothing to undo.
    pass
