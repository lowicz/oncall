from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.auth import CurrentUser

#: One message for one cause (LOW6-02), defined with the domain error it names;
#: member-scoped endpoints outside the domain answer 403 with the same text.
from oncall.domain.errors import NOT_A_TEAM_MEMBER as NOT_A_TEAM_MEMBER
from oncall.models import TeamMember, User, UserRole


def require_roles(
    *allowed_roles: UserRole,
) -> Callable[[CurrentUser], Coroutine[Any, Any, User]]:
    async def dependency(user: CurrentUser) -> User:
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Nie masz uprawnień do tej operacji",
            )
        return user

    return dependency


async def team_member_or_none(user: User, db: AsyncSession) -> TeamMember | None:
    """The rotation member this account is linked to, or ``None``."""
    return await db.scalar(select(TeamMember).where(TeamMember.user_id == user.id))


async def team_member_for_user(user: User, db: AsyncSession) -> TeamMember:
    """The rotation member this account is linked to.

    Raises 403 :data:`NOT_A_TEAM_MEMBER` when there is none - the single
    response every member-scoped endpoint gives for that case.
    """
    member = await team_member_or_none(user, db)
    if member is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, NOT_A_TEAM_MEMBER)
    return member
