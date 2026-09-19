"""What signing in and the one-time account links take and give back."""

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta

from oncall.domain.accounts import Account, SignedInSession
from oncall.domain.vocabulary import AccountTokenKind

#: A single shared office IP must not lock out everyone behind it because one
#: person mistyped their own password a handful of times; the per-account
#: limit stays tight, the per-IP limit is a much
#: coarser backstop against volume - credential stuffing with a different
#: login on every request, so the per-account counter never trips - that
#: only a real flood reaches.
LOGIN_ATTEMPTS_PER_USERNAME = 5
LOGIN_ATTEMPTS_PER_IP = 20
LOGIN_THROTTLE_WINDOW = timedelta(minutes=5)
#: Repeated failures of one login within this window are one series.
FAILED_LOGIN_SERIES_WINDOW = timedelta(minutes=5)
#: Attempts are counted under labels that fit the audit trail's actor column.
ATTEMPT_LABEL_LENGTH = 160


def retry_after_seconds(throttled_times: int) -> int:
    """Doubling with each repeated trigger within the window (capped at five
    minutes), so a caller that keeps hammering the door is told to wait
    longer each time instead of a flat 60 s."""
    return min(300, 60 * 2 ** min(throttled_times - 1, 3))


@dataclass(frozen=True)
class SignInRequest:
    username: str
    password: str
    client_ip: str

    @property
    def login(self) -> str:
        return self.username.strip().lower()

    @property
    def login_label(self) -> str:
        return self.login[:ATTEMPT_LABEL_LENGTH]

    @property
    def ip_label(self) -> str:
        return f"ip:{self.client_ip}"[:ATTEMPT_LABEL_LENGTH]


@dataclass(frozen=True)
class StoredCredentials:
    account: Account
    #: Opaque to the domain; only the password hasher reads it.
    password_hash: str | None

    @property
    def password_set(self) -> bool:
        return self.password_hash is not None


@dataclass(frozen=True)
class DirectoryIdentity:
    """A person as the directory (Active Directory) vouches for them."""

    username: str
    personnel_number: str
    first_name: str
    last_name: str
    email: str | None


@dataclass(frozen=True)
class SignedIn:
    account: Account
    session: SignedInSession
    has_team_member: bool


@dataclass(frozen=True)
class AccountLink:
    """A one-time activation or password-reset link, with its account."""

    id: uuid.UUID
    kind: AccountTokenKind
    expires_at: datetime
    used_at: datetime | None
    credentials: StoredCredentials


@dataclass(frozen=True)
class PasswordChoice:
    token: str
    kind: AccountTokenKind
    password: str


@dataclass(frozen=True)
class AccountOverview:
    account: Account
    has_team_member: bool
