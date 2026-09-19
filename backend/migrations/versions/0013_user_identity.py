"""Split account identity: personnel number, given name and surname.

The organisation identifies people by a numeric personnel number, with the
given name and surname held separately, so one `display_name` string could not
represent an account. `auth_source` prepares for LDAP/AD sign-in alongside local
accounts, and `password_hash` becomes optional because directory accounts never
store one here.
"""

import sqlalchemy as sa
from alembic import op

revision = "0013_user_identity"
down_revision = "0012_assignment_member_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Stored as text, not an integer: personnel numbers routinely carry leading
    # zeros ("004512") and an integer would silently drop them.
    op.add_column("users", sa.Column("personnel_number", sa.String(length=32), nullable=True))
    op.create_unique_constraint("uq_user_personnel_number", "users", ["personnel_number"])
    op.create_check_constraint(
        "ck_user_personnel_number_digits",
        "users",
        "personnel_number IS NULL OR personnel_number ~ '^[0-9]+$'",
    )
    op.add_column("users", sa.Column("first_name", sa.String(length=120), nullable=True))
    op.add_column(
        "users",
        sa.Column("last_name", sa.String(length=120), nullable=False, server_default=""),
    )
    op.add_column(
        "users",
        sa.Column("auth_source", sa.String(length=16), nullable=False, server_default="local"),
    )

    # Normalize whitespace and split on the first space. Accounts without a
    # space (for example "Administrator") keep the whole value as the given
    # name and receive an empty surname.
    op.execute(
        """
        UPDATE users
        SET first_name = split_part(
                regexp_replace(trim(display_name), '\\s+', ' ', 'g'), ' ', 1
            ),
            last_name = CASE
                WHEN position(' ' in regexp_replace(trim(display_name), '\\s+', ' ', 'g')) = 0
                    THEN ''
                ELSE substring(
                    regexp_replace(trim(display_name), '\\s+', ' ', 'g')
                    FROM position(' ' in regexp_replace(trim(display_name), '\\s+', ' ', 'g')) + 1
                )
            END
        """
    )
    op.alter_column("users", "first_name", nullable=False)
    op.alter_column("users", "password_hash", existing_type=sa.String(length=255), nullable=True)
    op.drop_column("users", "display_name")


def downgrade() -> None:
    op.add_column(
        "users", sa.Column("display_name", sa.String(length=160), nullable=False, server_default="")
    )
    op.execute(
        """
        UPDATE users
        SET display_name = trim(first_name || ' ' || last_name)
        """
    )
    # A directory account has no local secret to restore. The empty value is an
    # invalid Argon2 hash, so such an account remains safely unable to log in.
    op.execute("UPDATE users SET password_hash = '' WHERE password_hash IS NULL")
    op.alter_column("users", "password_hash", existing_type=sa.String(length=255), nullable=False)
    op.drop_column("users", "auth_source")
    op.drop_column("users", "last_name")
    op.drop_column("users", "first_name")
    op.drop_constraint("ck_user_personnel_number_digits", "users", type_="check")
    op.drop_constraint("uq_user_personnel_number", "users", type_="unique")
    op.drop_column("users", "personnel_number")
