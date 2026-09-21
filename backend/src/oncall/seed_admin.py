import asyncio
import os

from sqlalchemy import select

import oncall.infrastructure.sqlalchemy.model_registry  # noqa: F401  # registers every mapper
from oncall.auth import hash_password
from oncall.database import SessionFactory
from oncall.domain.vocabulary import UserRole
from oncall.infrastructure.sqlalchemy.access_models import User


async def seed_admin() -> None:
    username = os.environ.get("ONCALL_ADMIN_USERNAME")
    password = os.environ.get("ONCALL_ADMIN_PASSWORD")
    display_name = os.environ.get("ONCALL_ADMIN_DISPLAY_NAME", "Administrator")
    if not username and not password:
        print("Admin bootstrap skipped: credentials are not configured.")
        return
    if not username or not password or len(password) < 12:
        raise SystemExit(
            "Set both ONCALL_ADMIN_USERNAME and ONCALL_ADMIN_PASSWORD (minimum 12 characters)."
        )

    async with SessionFactory() as db:
        user = await db.scalar(select(User).where(User.username == username))
        if user is None:
            db.add(
                User(
                    username=username,
                    display_name=display_name,
                    password_hash=hash_password(password),
                    role=UserRole.admin,
                )
            )
            action = "Created"
        else:
            # Bootstrap credentials are authoritative, so password rotation takes
            # effect on the next container start without exposing it in logs.
            user.display_name = display_name
            user.password_hash = hash_password(password)
            user.role = UserRole.admin
            user.is_active = True
            action = "Synchronized"
        await db.commit()
    print(f"{action} environment-managed admin user {username!r}.")


if __name__ == "__main__":
    asyncio.run(seed_admin())
