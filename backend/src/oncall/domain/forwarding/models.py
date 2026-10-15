import uuid
from dataclasses import dataclass
from datetime import date, datetime
from enum import StrEnum

#: Where the WCO admin panel answers unless an administrator says otherwise.
DEFAULT_BASE_URL = "https://wco.orange.pl"


class ForwardingMode(StrEnum):
    """How far the forwarding pass goes."""

    #: It does not touch WCO. The default: nothing is forwarded until an
    #: administrator turns it on.
    off = "off"
    #: It logs in and reads the number WCO forwards to, and records what it
    #: would set, without writing anything to WCO.
    dry_run = "dry_run"
    #: It sets the forwarding number.
    live = "live"


class ForwardingOutcome(StrEnum):
    """What the last forwarding pass did."""

    applied = "applied"
    unchanged = "unchanged"
    failed = "failed"
    skipped_no_primary = "skipped_no_primary"
    skipped_no_phone = "skipped_no_phone"
    dry_run = "dry_run"


@dataclass(frozen=True)
class ForwardingSettings:
    """The WCO account the forwarding pass uses. The password itself is never
    part of the settings, readers learn only whether one is set: only the
    audited reveal decrypts it, for an administrator."""

    id: uuid.UUID
    mode: ForwardingMode
    base_url: str
    #: The switchboard number WCO's login asks for.
    vpbx_number: str | None
    username: str | None
    #: The WCO user whose number is the forwarding target.
    wco_user_id: str | None
    password_set: bool
    password_changed_at: datetime | None
    #: Set while a password the pass generated waits to be confirmed by WCO.
    rotation_pending_since: datetime | None
    #: Set once WCO refused every stored password; the pass stops logging in
    #: until an administrator enters a new one.
    credentials_invalid_since: datetime | None
    updated_at: datetime


@dataclass(frozen=True)
class RevealedPasswords:
    """The stored WCO passwords in the clear, for an administrator who
    confirmed it is them, to switch the number by hand in WCO's own panel."""

    current: str
    #: Set while a rotation is half done: WCO holds either this one or
    #: `current`, so try it first, as the forwarding pass does.
    pending: str | None
    pending_since: datetime | None
    credentials_invalid_since: datetime | None
    password_changed_at: datetime | None


@dataclass(frozen=True)
class SettingsChange:
    """The settings as an administrator saves them, the password apart."""

    mode: ForwardingMode
    base_url: str
    vpbx_number: str | None
    username: str | None
    wco_user_id: str | None
    updated_by_user_id: uuid.UUID

    @property
    def complete(self) -> bool:
        """Whether it names everything a login to WCO needs but the password."""
        return bool(self.vpbx_number and self.username and self.wco_user_id)


@dataclass(frozen=True)
class ForwardingState:
    """Where forwarding stands, as the last pass left it."""

    #: The number WCO confirmed it forwards to, and whose it is.
    applied_number: str | None
    applied_member_name: str | None
    applied_at: datetime | None
    #: What the last pass wanted to forward to, for which duty day.
    desired_number: str | None
    desired_member_name: str | None
    desired_for_day: date | None
    last_attempt_at: datetime | None
    last_outcome: ForwardingOutcome | None
    last_error: str | None
    failing_since: datetime | None
    attempts: int
    next_attempt_at: datetime | None
