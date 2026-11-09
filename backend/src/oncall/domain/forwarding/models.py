import uuid
from dataclasses import dataclass, field
from datetime import date, datetime
from enum import StrEnum

from oncall.domain.forwarding.passwords import Passwords
from oncall.domain.vocabulary import AssignmentRole

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


#: The outcomes after which the pass still owes the current target.
FAILING_OUTCOMES = (
    ForwardingOutcome.failed,
    ForwardingOutcome.skipped_no_primary,
    ForwardingOutcome.skipped_no_phone,
)


class HandoverEnd(StrEnum):
    """Why a number handover ended."""

    #: One of the pair, a coordinator or an administrator ended it.
    manual = "manual"
    #: Its `until` passed, or the duty day it was made on did.
    expired = "expired"
    #: A change to the roster took one of its two people out of the day's pair.
    roster_change = "roster_change"


class SwitchStatus(StrEnum):
    """Whether WCO already rings where the number should ring now."""

    #: WCO confirmed the number, or in a dry run the pass recorded it.
    confirmed = "confirmed"
    #: The pass has not reached it yet, or retries a failure it does not
    #: alert about yet.
    switching = "switching"
    #: The failure alert went out: the number still rings somewhere else.
    failed = "failed"


class ConnectionTestOutcome(StrEnum):
    """What an administrator's "check the connection" learned from WCO. It
    logs in the way the forwarding pass does and reads the user whose number
    is forwarded to; it never writes."""

    #: Logged in and read the user: `number` is what WCO forwards to now.
    ok = "ok"
    #: The login succeeded, but WCO wants the password changed first; a pass
    #: in `live` mode does that by itself.
    password_expired = "password_expired"
    #: WCO refused every stored password.
    login_refused = "login_refused"
    #: No usable answer came: the network, a 5xx, an unexpected response.
    connection = "connection"
    #: This deployment cannot open a verified connection: `ONCALL_CA_FILE`
    #: names no readable bundle.
    configuration = "configuration"


@dataclass(frozen=True)
class WcoAccount:
    """Everything a login to WCO needs, the passwords in the clear."""

    base_url: str
    vpbx_number: str
    username: str
    wco_user_id: str
    passwords: Passwords = field(repr=False)


@dataclass(frozen=True)
class ConnectionTest:
    outcome: ConnectionTestOutcome
    #: The number WCO forwards to, when it could be read.
    number: str | None = None
    #: The failed call and its HTTP status, or the operator's configuration
    #: error: never what WCO answered with.
    detail: str | None = None


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
    #: The target whose failure alert went out (`ForwardingTarget.failure_alert_key`).
    alerted_for: str | None = None


@dataclass(frozen=True)
class NumberHandover:
    """The day's PRIMARY lets the SECONDARY take the on-call number until
    `until`; at most one is open, and the forwarding pass reads it."""

    id: uuid.UUID
    #: The duty day it was made on (`oncall.domain.forwarding.job.forwarding_day`).
    day: date
    from_member_id: uuid.UUID
    from_name: str
    to_member_id: uuid.UUID
    to_name: str
    starts_at: datetime
    until: datetime
    #: Who started it; None once their account is gone.
    started_by_name: str | None = None


@dataclass(frozen=True)
class PairMember:
    """One side of the duty day's pair, as the handover controls need it:
    whether a phone number is set, never the number."""

    name: str
    #: The person's team member, so a screen finds their duty by id, not by a name two people may share.
    member_id: uuid.UUID
    #: Whether the reader is this person.
    is_you: bool
    has_phone: bool


@dataclass(frozen=True)
class HandoverPair:
    """The duty day's PRIMARY and SECONDARY, between whom the number is
    handed over."""

    primary: PairMember
    secondary: PairMember


@dataclass(frozen=True)
class ForwardingNow:
    """Where the on-call number rings now, as anyone signed in may read it:
    names and roles, never a number. Everything but `mode` is None while
    forwarding is off, since the application then cannot tell."""

    mode: ForwardingMode
    day: date | None = None
    #: When the duty day ends and the number passes to the next PRIMARY: the
    #: latest a handover may last.
    day_ends_at: datetime | None = None
    holder_member_id: uuid.UUID | None = None
    holder_name: str | None = None
    #: PRIMARY, or SECONDARY while a handover holds.
    holder_role: AssignmentRole | None = None
    handover: NumberHandover | None = None
    status: SwitchStatus | None = None
    #: When WCO confirmed the number (a dry run: when the pass recorded it).
    confirmed_at: datetime | None = None
    #: The duty day's pair, only for whoever may hand the number over
    #: between them (D1): either of them or a coordinator.
    pair: HandoverPair | None = None
