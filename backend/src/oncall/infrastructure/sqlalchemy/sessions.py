"""Signed-in sessions, stored as token hashes."""

import secrets
import uuid
from datetime import datetime

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.auth import token_hash
from oncall.domain.accounts import SignedInSession
from oncall.infrastructure.sqlalchemy.access_models import Session


class SqlAlchemySessions:
    """Signed-in sessions. The raw token leaves only in the returned value;
    the database keeps its hash."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def _open(self, expires_at: datetime, **owner: uuid.UUID | None) -> SignedInSession:
        raw_token = secrets.token_urlsafe(32)
        csrf_token = secrets.token_urlsafe(32)
        self._session.add(
            Session(
                token_hash=token_hash(raw_token),
                csrf_token=csrf_token,
                expires_at=expires_at,
                **owner,
            )
        )
        return SignedInSession(token=raw_token, csrf_token=csrf_token, expires_at=expires_at)

    async def open_for_account(
        self, account_id: uuid.UUID, expires_at: datetime
    ) -> SignedInSession:
        return await self._open(expires_at, user_id=account_id)

    async def open_for_share_link(
        self, link_id: uuid.UUID, expires_at: datetime
    ) -> SignedInSession:
        return await self._open(expires_at, user_id=None, share_link_id=link_id)

    async def end_all_for_account(self, account_id: uuid.UUID) -> None:
        await self._session.execute(delete(Session).where(Session.user_id == account_id))

    async def end(self, stored: Session) -> None:
        await self._session.delete(stored)
