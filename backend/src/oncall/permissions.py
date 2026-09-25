from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.auth import CurrentUser
from oncall.domain.vocabulary import UserRole
from oncall.i18n import translate
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.team_models import TeamMember


def require_roles(
    *allowed_roles: UserRole,
) -> Callable[[CurrentUser], Coroutine[Any, Any, User]]:
    async def dependency(user: CurrentUser) -> User:
        if user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=translate("access.forbidden"),
            )
        return user

    return dependency


async def team_member_or_none(user: User, db: AsyncSession) -> TeamMember | None:
    """The rotation member this account is linked to, or ``None``."""
    return await db.scalar(select(TeamMember).where(TeamMember.user_id == user.id))


async def team_member_for_user(user: User, db: AsyncSession) -> TeamMember:
    """The rotation member this account is linked to.

    Raises 403 with the `NotATeamMember` sentence when there is none - the single
    response every member-scoped endpoint gives for that case.
    """
    member = await team_member_or_none(user, db)
    if member is None:
        raise HTTPException(status.HTTP_403_FORBIDDEN, translate("domain.not_a_team_member"))
    return member
