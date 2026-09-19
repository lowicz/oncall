"""Case-insensitive uniqueness for usernames and e-mail addresses.

Revision ID: 0029_user_identity_ci
Revises: 0028_schedule_run_active_range
"""

from alembic import op
from sqlalchemy import text

revision = "0029_user_identity_ci"
down_revision = "0028_schedule_run_active_range"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    conflicts = connection.execute(
        text(
            "SELECT 'username' AS field, lower(username) AS value FROM users "
            "GROUP BY lower(username) HAVING count(*) > 1 UNION ALL "
            "SELECT 'email', lower(email) FROM users WHERE email IS NOT NULL "
            "GROUP BY lower(email) HAVING count(*) > 1"
        )
    ).fetchall()
    if conflicts:
        details = ", ".join(f"{row.field}={row.value}" for row in conflicts)
        raise RuntimeError(f"Case-insensitive user identity conflicts: {details}")
    op.execute("CREATE UNIQUE INDEX uq_users_username_lower ON users (lower(username))")
    op.execute(
        "CREATE UNIQUE INDEX uq_users_email_lower ON users (lower(email)) "
        "WHERE email IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_index("uq_users_email_lower", table_name="users")
    op.drop_index("uq_users_username_lower", table_name="users")
