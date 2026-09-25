import hashlib
import secrets
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated

import anyio
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from fastapi import Cookie, Depends, Header, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from oncall.config import get_settings
from oncall.database import get_db
from oncall.domain.clock import as_utc as as_utc
from oncall.domain.clock import utc_now
from oncall.domain.sharing.models import link_is_active
from oncall.domain.vocabulary import UserRole
from oncall.i18n import translate
from oncall.infrastructure.sqlalchemy.access_models import Session, User
from oncall.infrastructure.sqlalchemy.sharing_models import ShareLink

password_hasher = PasswordHasher()


def hash_password(password: str) -> str:
    return password_hasher.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    if password_hash is None:
        return False
    try:
        return password_hasher.verify(password_hash, password)
    except InvalidHashError, VerifyMismatchError:
        return False


DUMMY_PASSWORD_HASH = hash_password("dummy-password-used-only-to-equalize-login-cost")


async def hash_password_async(password: str) -> str:
    return await anyio.to_thread.run_sync(hash_password, password)


async def verify_password_async(password_hash: str | None, password: str) -> bool:
    return await anyio.to_thread.run_sync(verify_password, password_hash, password)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def share_link_active(link: ShareLink, now: datetime | None = None) -> bool:
    return link_is_active(link.revoked_at, link.expires_at, now or utc_now())


def set_session_cookie(response: Response, raw_token: str, expires_at: datetime) -> None:
    settings = get_settings()
    max_age = max(0, int((expires_at - utc_now()).total_seconds()))
    response.set_cookie(
        settings.session_cookie_name,
        raw_token,
        httponly=True,
        secure=settings.session_cookie_secure,
        samesite="lax",
        max_age=max_age,
        path="/",
    )


async def get_current_session(
    db: Annotated[AsyncSession, Depends(get_db, scope="function")],
    oncall_session: Annotated[str | None, Cookie(alias=get_settings().session_cookie_name)] = None,
) -> Session:
    if not oncall_session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=translate("access.no_active_session")
        )
    hashed_token = token_hash(oncall_session)
    query = (
        select(Session)
        .options(joinedload(Session.user), joinedload(Session.share_link))
        .where(
            Session.token_hash == hashed_token,
            Session.expires_at > utc_now(),
        )
    )
    session = await db.scalar(query)
    if session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=translate("access.session_expired")
        )
    if session.user is not None and not session.user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail=translate("access.account_inactive")
        )
    if session.share_link is not None and not share_link_active(session.share_link):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=translate("sharing.link_expired_or_revoked"),
        )
    return session


@dataclass
class Principal:
    """Whoever holds the session: a named user or a temporary share link."""

    session: Session

    @property
    def user(self) -> User | None:
        return self.session.user

    @property
    def share_link(self) -> ShareLink | None:
        return self.session.share_link

    @property
    def role(self) -> UserRole:
        return self.user.role if self.user is not None else UserRole.viewer

    @property
    def display_name(self) -> str:
        if self.user is not None:
            return self.user.display_name
        if self.share_link is not None:
            return self.share_link.label
        return ""


async def get_current_principal(
    session: Annotated[Session, Depends(get_current_session)],
) -> Principal:
    return Principal(session=session)


async def get_current_user(
    principal: Annotated[Principal, Depends(get_current_principal)],
) -> User:
    if principal.user is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=translate("access.share_session_not_an_account"),
        )
    return principal.user


async def verify_csrf(
    session: Annotated[Session, Depends(get_current_session)],
    csrf_token: Annotated[str | None, Header(alias="X-CSRF-Token")] = None,
) -> None:
    if csrf_token is None or not secrets.compare_digest(session.csrf_token, csrf_token):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=translate("access.invalid_csrf_token"),
        )


CurrentUser = Annotated[User, Depends(get_current_user)]
CurrentPrincipal = Annotated[Principal, Depends(get_current_principal)]
CsrfGuard = Annotated[None, Depends(verify_csrf)]
