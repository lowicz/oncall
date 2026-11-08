import uuid
from dataclasses import dataclass
from datetime import date, datetime
from typing import Protocol

from oncall.domain.access.ports import ConfirmationPorts
from oncall.domain.forwarding.models import (
    ConnectionTest,
    ForwardingSettings,
    ForwardingState,
    HandoverEnd,
    NumberHandover,
    SettingsChange,
    WcoAccount,
)
from oncall.domain.forwarding.passwords import Passwords
from oncall.domain.ports import PublishedRoster
from oncall.domain.team import Member


class CurrentSettings(Protocol):
    async def current(self) -> ForwardingSettings:
        """The one settings row, created with defaults on first use."""
        ...


class SettingsStore(Protocol):
    async def current(self) -> ForwardingSettings:
        """The one settings row, created with defaults on first use."""
        ...

    async def change(
        self, change: SettingsChange, password_token: str | None
    ) -> ForwardingSettings:
        """Stage the change and answer with the settings as they now stand.
        A `password_token` replaces the stored password and clears what the
        old one left behind; None keeps it."""
        ...


class PasswordCipher(Protocol):
    """Encryption of the stored WCO password."""

    def available(self) -> bool:
        """Whether the process holds a key to encrypt with."""
        ...

    def encrypt(self, plaintext: str) -> str: ...

    def decrypt(self, token: str) -> str: ...


class ForwardingContacts(Protocol):
    """Whether any roster was ever published, and the phone attached to a
    roster identity."""

    async def roster_published(self) -> bool: ...

    async def phone(self, member_id: uuid.UUID) -> str | None: ...


class SettingsJournal(Protocol):
    """The audit entry of a settings change, in the name of the administrator."""

    def settings_updated(self, settings: ForwardingSettings, *, password_changed: bool) -> None: ...


@dataclass(frozen=True)
class SettingsPorts:
    settings: SettingsStore
    cipher: PasswordCipher
    journal: SettingsJournal


class StoredPasswords(Protocol):
    async def current(self) -> ForwardingSettings:
        """The one settings row, created with defaults on first use."""
        ...

    async def tokens(self) -> Passwords | None:
        """The stored passwords as their encrypted tokens, None when no
        password is stored."""
        ...


class PasswordReader(Protocol):
    """Decryption of the stored WCO passwords for a reveal."""

    def available(self) -> bool:
        """Whether the process holds a key."""
        ...

    def read(self, token: str) -> str | None:
        """The plaintext, or None when no key the process holds opens it."""
        ...


class RevealJournal(Protocol):
    """The audit entry of a reveal, in the name of the administrator: who
    and when, never the value."""

    def password_revealed(
        self, settings: ForwardingSettings, *, pending_included: bool
    ) -> None: ...


@dataclass(frozen=True)
class RevealPorts:
    settings: StoredPasswords
    cipher: PasswordReader
    confirm: ConfirmationPorts
    journal: RevealJournal


class ConnectionProbe(Protocol):
    """One read-only round trip to WCO with the account's stored passwords."""

    async def __call__(self, account: WcoAccount) -> ConnectionTest: ...


class TestJournal(Protocol):
    """The audit entry of a connection test, in the name of the administrator."""

    def connection_tested(self, settings: ForwardingSettings, result: ConnectionTest) -> None: ...


@dataclass(frozen=True)
class ConnectionTestPorts:
    settings: StoredPasswords
    cipher: PasswordReader
    probe: ConnectionProbe
    journal: TestJournal


class CurrentState(Protocol):
    async def current(self) -> ForwardingState:
        """The one state row, created empty on first use."""
        ...


class OpenHandover(Protocol):
    async def open(self) -> NumberHandover | None:
        """The handover nobody ended yet; at most one exists."""
        ...


class HandoverStore(Protocol):
    async def open(self) -> NumberHandover | None:
        """The handover nobody ended yet; at most one exists."""
        ...

    async def start(
        self,
        *,
        day: date,
        from_member_id: uuid.UUID,
        to_member_id: uuid.UUID,
        until: datetime,
        now: datetime,
        by_user_id: uuid.UUID,
    ) -> NumberHandover:
        """Open a handover; `errors.HandoverActive` when another one was
        opened meanwhile."""
        ...

    async def end(
        self,
        handover: NumberHandover,
        reason: HandoverEnd,
        *,
        at: datetime,
        by_user_id: uuid.UUID | None,
    ) -> bool:
        """End it unless it already ended: True for the one caller that did."""
        ...


class HandoverJournal(Protocol):
    """The audit entries of a handover, and the mail of the one end its
    people did not see coming."""

    def started(self, handover: NumberHandover) -> None: ...

    def ended(self, handover: NumberHandover, reason: HandoverEnd) -> None: ...

    async def ended_by_roster_change(
        self, handover: NumberHandover, primary_name: str | None
    ) -> None:
        """Tell both people the number went back to `primary_name`."""
        ...


@dataclass(frozen=True)
class HandoverPorts:
    handovers: HandoverStore
    journal: HandoverJournal


class AccountMembers(Protocol):
    async def member_for_account(self, user_id: uuid.UUID) -> Member | None: ...


@dataclass(frozen=True)
class HandoverChangePorts:
    settings: CurrentSettings
    roster: PublishedRoster
    contacts: ForwardingContacts
    team: AccountMembers
    handover: HandoverPorts


@dataclass(frozen=True)
class ForwardingNowPorts:
    settings: CurrentSettings
    roster: PublishedRoster
    contacts: ForwardingContacts
    handovers: OpenHandover
    state: CurrentState
