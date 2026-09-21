"""What the account owner's own operations need, one consumer at a time:
signing in, choosing a password through a one-time link, and the owner's own
profile.
"""

import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Protocol

from oncall.domain.access.models import (
    AccountLink,
    DirectoryIdentity,
    SignInRequest,
    StoredCredentials,
)
from oncall.domain.accounts import Account, SignedInSession
from oncall.domain.vocabulary import AccountTokenKind


class LoginAttempts(Protocol):
    """The record of sign-in attempts the throttle counts."""

    async def failures_since(self, label: str, since: datetime) -> int:
        """Failed attempts recorded under this label (a login or an address)."""
        ...

    async def throttled(self, label: str, since: datetime) -> int:
        """Record that the label was turned away again; how many times it has
        been within the window, this one included."""
        ...

    async def failed(self, request: SignInRequest, since: datetime) -> None:
        """Record a failed attempt under the login and the address."""
        ...

    async def directory_unavailable(self, login: str, reason: str) -> None: ...

    async def identity_conflict(self, login: str) -> None: ...


class SignInAccounts(Protocol):
    """Accounts as signing in finds them, and as the directory keeps them."""

    async def credentials_for_login(self, login: str) -> StoredCredentials | None: ...

    async def has_team_member(self, account_id: uuid.UUID) -> bool: ...

    async def account_with_personnel_number(self, personnel_number: str) -> Account | None: ...

    async def account_named(self, login: str) -> Account | None:
        """Case-insensitive."""
        ...

    async def provision_from_directory(self, login: str, identity: DirectoryIdentity) -> Account:
        """A new viewer account the directory vouches for."""
        ...

    async def link_to_directory(
        self, account_id: uuid.UUID, login: str, identity: DirectoryIdentity
    ) -> Account:
        """Convert a local account: the directory becomes the only way in, its
        identity replaces the local one, role, activity and rotation stay."""
        ...

    async def update_from_directory(
        self, account_id: uuid.UUID, changes: dict[str, str | None]
    ) -> Account: ...


class PasswordVerifier(Protocol):
    async def verify(self, password_hash: str | None, password: str) -> bool: ...

    async def verify_decoy(self, password: str) -> None:
        """Spend what a real verification costs, so a refusal takes as long
        whether or not the account exists."""
        ...


class Directory(Protocol):
    async def authenticate(self, login: str, password: str) -> DirectoryIdentity | None:
        """The identity for these credentials, or None when the directory
        refuses them or is not in use. Raises `DirectoryFailure`."""
        ...


class AccountSessions(Protocol):
    async def open_for_account(
        self, account_id: uuid.UUID, expires_at: datetime
    ) -> SignedInSession: ...


class SignInJournal(Protocol):
    async def signed_in(self, account: Account) -> None: ...

    async def provisioned(self, account: Account) -> None: ...

    async def linked(self, account: Account, *, login: str) -> None: ...

    async def synced(self, account: Account, *, fields: list[str]) -> None: ...


@dataclass(frozen=True)
class SignInPorts:
    attempts: LoginAttempts
    accounts: SignInAccounts
    passwords: PasswordVerifier
    directory: Directory
    sessions: AccountSessions
    journal: SignInJournal


class AccountLinks(Protocol):
    async def link(self, token: str, kind: AccountTokenKind) -> AccountLink | None: ...

    async def link_for_use(self, token: str, kind: AccountTokenKind) -> AccountLink | None:
        """The link, held until the unit of work ends so it is used once."""
        ...

    async def mark_used(self, link_id: uuid.UUID, at: datetime) -> None: ...


class AccountPasswords(Protocol):
    async def set_password(self, account_id: uuid.UUID, password_hash: str) -> None: ...


class PasswordHasher(Protocol):
    async def hash(self, password: str) -> str: ...


class AccountSignOut(Protocol):
    async def end_all_for_account(self, account_id: uuid.UUID) -> None: ...


class PasswordJournal(Protocol):
    async def password_set(self, account: Account, kind: AccountTokenKind) -> None: ...


@dataclass(frozen=True)
class PasswordPorts:
    links: AccountLinks
    accounts: AccountPasswords
    passwords: PasswordHasher
    sessions: AccountSignOut
    journal: PasswordJournal


class OwnProfiles(Protocol):
    """The details account owners read and edit themselves."""

    async def has_team_member(self, account_id: uuid.UUID) -> bool: ...

    async def change_phone(self, account_id: uuid.UUID, phone: str | None) -> Account: ...
