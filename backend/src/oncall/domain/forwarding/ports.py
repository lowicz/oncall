import uuid
from dataclasses import dataclass
from typing import Protocol

from oncall.domain.forwarding.models import ForwardingSettings, ForwardingState, SettingsChange


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
    """The phone attached to a roster identity."""

    async def phone(self, member_id: uuid.UUID) -> str | None: ...


class SettingsJournal(Protocol):
    """The audit entry of a settings change, in the name of the administrator."""

    def settings_updated(self, settings: ForwardingSettings, *, password_changed: bool) -> None: ...


@dataclass(frozen=True)
class SettingsPorts:
    settings: SettingsStore
    cipher: PasswordCipher
    journal: SettingsJournal


class CurrentState(Protocol):
    async def current(self) -> ForwardingState:
        """The one state row, created empty on first use."""
        ...
