import uuid
from dataclasses import dataclass
from typing import Protocol

from oncall.domain.access.ports import ConfirmationPorts
from oncall.domain.forwarding.models import (
    ConnectionTest,
    ForwardingSettings,
    ForwardingState,
    SettingsChange,
    WcoAccount,
)
from oncall.domain.forwarding.passwords import Passwords


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
