from collections.abc import Callable, Coroutine
from typing import Any

from fastapi import HTTPException, status

from oncall.auth import CurrentUser
from oncall.domain.vocabulary import UserRole
from oncall.i18n import translate
from oncall.infrastructure.sqlalchemy.access_models import User


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
