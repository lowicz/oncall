"""Accounts, credentials, sign-in attempts and account links for signing in."""

import uuid
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from oncall.audit import record_audit
from oncall.auth import token_hash
from oncall.domain.access import errors
from oncall.domain.access.models import (
    AccountLink,
    DirectoryIdentity,
    SignInRequest,
    StoredCredentials,
)
from oncall.domain.accounts import Account
from oncall.domain.clock import utc_now
from oncall.domain.vocabulary import AccountTokenKind, AuthSource, UserRole
from oncall.infrastructure.sqlalchemy.access_models import AccountToken, User
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.team_models import TeamMember

#: Sign-in attempts live in the audit trail under these actions.
ATTEMPT = "auth.login_attempt"
FAILURE_SERIES = "auth.login_failed"
THROTTLE_SERIES = "auth.throttled"


def account_from_row(row: User) -> Account:
    return Account(
        id=row.id,
        username=row.username,
        personnel_number=row.personnel_number,
        first_name=row.first_name,
        last_name=row.last_name,
        auth_source=row.auth_source,
        role=row.role,
        email=row.email,
        phone=row.phone,
        is_active=row.is_active,
        created_at=row.created_at,
    )


def _credentials(row: User) -> StoredCredentials:
    return StoredCredentials(account=account_from_row(row), password_hash=row.password_hash)


class SqlAlchemyLoginAttempts:
    """Attempts are audit rows: one per failed attempt per label, and one
    rolling row per series of failures or of throttling, so a flood does not
    write a row per request."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def failures_since(self, label: str, since: datetime) -> int:
        count = await self._session.scalar(
            select(func.count())
            .select_from(AuditEvent)
            .where(
                AuditEvent.action == ATTEMPT,
                AuditEvent.occurred_at >= since,
                AuditEvent.actor_label == label,
            )
        )
        return count or 0

    async def _series(self, action: str, label: str, since: datetime) -> AuditEvent | None:
        return await self._session.scalar(
            select(AuditEvent)
            .where(
                AuditEvent.action == action,
                AuditEvent.actor_label == label,
                AuditEvent.occurred_at >= since,
            )
            .order_by(AuditEvent.occurred_at.desc())
        )

    async def throttled(self, label: str, since: datetime) -> int:
        series = await self._series(THROTTLE_SERIES, label, since)
        if series is None:
            record_audit(
                self._session,
                actor=None,
                actor_label=label,
                action=THROTTLE_SERIES,
                summary="Ograniczono liczbę prób logowania",
                details={"count": 1},
            )
            return 1
        count = int((series.details or {}).get("count", 1)) + 1
        series.occurred_at = utc_now()
        series.details = {"count": count}
        return count

    async def failed(self, request: SignInRequest, since: datetime) -> None:
        for label in (request.login_label, request.ip_label):
            record_audit(
                self._session,
                actor=None,
                actor_label=label,
                action=ATTEMPT,
                summary="Nieudana próba uwierzytelnienia",
            )
        series = await self._series(FAILURE_SERIES, request.login_label, since)
        if series is None:
            record_audit(
                self._session,
                actor=None,
                actor_label=request.login_label,
                action=FAILURE_SERIES,
                summary=f"Nieudana próba logowania: {request.login[:120]}",
                details={"count": 1, "last_ip": request.client_ip},
            )
        else:
            series.occurred_at = utc_now()
            series.details = {
                "count": int((series.details or {}).get("count", 1)) + 1,
                "last_ip": request.client_ip,
            }

    async def directory_unavailable(self, login: str, reason: str) -> None:
        record_audit(
            self._session,
            actor=None,
            actor_label=login[:160],
            action="auth.ldap_unavailable",
            summary=f"Logowanie LDAP niedostępne: {login[:120]}",
            details={"reason": reason},
        )

    async def identity_conflict(self, login: str) -> None:
        record_audit(
            self._session,
            actor=None,
            actor_label=login[:160],
            action="auth.ldap_identity_conflict",
            summary=f"Nie można powiązać konta LDAP: {login[:120]}",
        )


class SqlAlchemyAccessAccounts:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def credentials_for_login(self, login: str) -> StoredCredentials | None:
        row = await self._session.scalar(select(User).where(User.username == login))
        return _credentials(row) if row is not None else None

    async def account_with_personnel_number(self, personnel_number: str) -> Account | None:
        row = await self._session.scalar(
            select(User)
            .options(selectinload(User.team_member))
            .where(User.personnel_number == personnel_number)
        )
        return account_from_row(row) if row is not None else None

    async def account_named(self, login: str) -> Account | None:
        row = await self._session.scalar(select(User).where(func.lower(User.username) == login))
        return account_from_row(row) if row is not None else None

    async def has_team_member(self, account_id: uuid.UUID) -> bool:
        member_id = await self._session.scalar(
            select(TeamMember.id).where(TeamMember.user_id == account_id)
        )
        return member_id is not None

    async def provision_from_directory(self, login: str, identity: DirectoryIdentity) -> Account:
        row = User(
            username=login,
            personnel_number=identity.personnel_number,
            first_name=identity.first_name,
            last_name=identity.last_name,
            email=identity.email,
            auth_source=AuthSource.ldap,
            password_hash=None,
            role=UserRole.viewer,
            is_active=True,
        )
        self._session.add(row)
        await self._session.flush()
        return account_from_row(row)

    async def _with_member(self, account_id: uuid.UUID) -> User:
        return await self._session.scalar(
            select(User).options(selectinload(User.team_member)).where(User.id == account_id)
        )

    async def link_to_directory(
        self, account_id: uuid.UUID, login: str, identity: DirectoryIdentity
    ) -> Account:
        row = await self._with_member(account_id)
        row.auth_source = AuthSource.ldap
        row.password_hash = None
        row.username = login
        row.first_name = identity.first_name
        row.last_name = identity.last_name
        row.email = identity.email
        if row.team_member is not None:
            row.team_member.display_name = row.display_name
        return account_from_row(row)

    async def update_from_directory(
        self, account_id: uuid.UUID, changes: dict[str, str | None]
    ) -> Account:
        row = await self._with_member(account_id)
        for field, value in changes.items():
            setattr(row, field, value)
        if row.team_member is not None:
            row.team_member.display_name = row.display_name
        return account_from_row(row)

    async def set_password(self, account_id: uuid.UUID, password_hash: str) -> None:
        row = await self._session.get(User, account_id)
        row.password_hash = password_hash

    async def change_phone(self, account_id: uuid.UUID, phone: str | None) -> Account:
        row = await self._session.get(User, account_id)
        if row is None:
            raise errors.AccountGone()
        row.phone = phone
        return account_from_row(row)


class SqlAlchemyAccountLinks:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    def _query(self, token: str, kind: AccountTokenKind):
        return (
            select(AccountToken)
            .options(selectinload(AccountToken.user))
            .where(AccountToken.token_hash == token_hash(token), AccountToken.kind == kind)
        )

    @staticmethod
    def _to_link(row: AccountToken | None) -> AccountLink | None:
        if row is None:
            return None
        return AccountLink(
            id=row.id,
            kind=row.kind,
            expires_at=row.expires_at,
            used_at=row.used_at,
            credentials=_credentials(row.user),
        )

    async def link(self, token: str, kind: AccountTokenKind) -> AccountLink | None:
        return self._to_link(await self._session.scalar(self._query(token, kind)))

    async def link_for_use(self, token: str, kind: AccountTokenKind) -> AccountLink | None:
        # Atomic use: the token row stays locked until the unit of work ends,
        # so a second use of the same link waits and then finds it used.
        row = await self._session.scalar(
            self._query(token, kind)
            .with_for_update(of=AccountToken)
            .execution_options(populate_existing=True)
        )
        return self._to_link(row)

    async def mark_used(self, link_id: uuid.UUID, at: datetime) -> None:
        row = await self._session.get(AccountToken, link_id)
        row.used_at = at


class SqlAlchemyAccessJournal:
    """Account events, each written in the name of the account itself."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def _record(self, account: Account, **entry) -> None:
        actor = await self._session.get(User, account.id)
        record_audit(self._session, actor=actor, entity_type="user", entity_id=account.id, **entry)

    async def signed_in(self, account: Account) -> None:
        await self._record(
            account, action="auth.login", summary=f"Zalogowano: {account.display_name}"
        )

    async def provisioned(self, account: Account) -> None:
        await self._record(
            account,
            action="auth.ldap_provisioned",
            summary=f"Automatycznie utworzono konto LDAP: {account.display_name}",
        )

    async def linked(self, account: Account, *, login: str) -> None:
        await self._record(
            account,
            action="auth.ldap_linked",
            summary=f"Dowiązano konto lokalne z LDAP: {account.display_name}",
            details={"username": login},
        )

    async def synced(self, account: Account, *, fields: list[str]) -> None:
        await self._record(
            account,
            action="auth.ldap_synced",
            summary=f"Zsynchronizowano dane konta LDAP: {account.display_name}",
            details={"fields": fields},
        )

    async def password_set(self, account: Account, kind: AccountTokenKind) -> None:
        await self._record(
            account,
            action=f"auth.{kind.value}",
            summary=(
                f"Aktywowano konto {account.username}"
                if kind == AccountTokenKind.activation
                else f"Zmieniono hasło konta {account.username}"
            ),
        )
