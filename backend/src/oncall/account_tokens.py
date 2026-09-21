import secrets
from datetime import datetime, timedelta

from sqlalchemy import update
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.auth import token_hash
from oncall.domain.clock import utc_now
from oncall.domain.vocabulary import AccountTokenKind
from oncall.infrastructure.sqlalchemy.access_models import AccountToken, User


async def issue_account_token(
    db: AsyncSession,
    user: User,
    kind: AccountTokenKind,
    *,
    lifetime: timedelta,
) -> tuple[str, datetime]:
    """Issue one raw token and invalidate older unused tokens of the same kind."""
    now = utc_now()
    await db.execute(
        update(AccountToken)
        .where(
            AccountToken.user_id == user.id,
            AccountToken.kind == kind,
            AccountToken.used_at.is_(None),
        )
        .values(used_at=now)
    )
    raw_token = secrets.token_urlsafe(32)
    expires_at = now + lifetime
    db.add(
        AccountToken(
            user_id=user.id,
            kind=kind,
            token_hash=token_hash(raw_token),
            expires_at=expires_at,
        )
    )
    return raw_token, expires_at
