"""Desired state and value objects for the WCO forwarding worker.

The duty day changes at the handover reminder hour. Before that hour the
previous day's PRIMARY still receives calls; from that hour onward today's
PRIMARY does, unless a number handover gives them to the day's SECONDARY
until a time within the day. The person's stored Polish E.164 number is sent
to WCO exactly as stored.
"""

import hashlib
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from enum import StrEnum

from oncall.domain.clock import BUSINESS_TIMEZONE
from oncall.domain.forwarding.models import (
    ForwardingMode,
    ForwardingOutcome,
    HandoverEnd,
    NumberHandover,
)
from oncall.domain.forwarding.passwords import Passwords
from oncall.domain.forwarding.ports import ForwardingContacts, HandoverPorts
from oncall.domain.ports import PublishedRoster
from oncall.domain.roster import Duty, Slot
from oncall.domain.vocabulary import AssignmentRole


class ForwardingClaimLost(RuntimeError):
    """The attempt no longer owns the lease or its settings snapshot."""


class ForwardingFailure(StrEnum):
    """A fixed, safe category for state, audit and failure mail.

    WCO response bodies never become one of these values or reach a reader.
    """

    connection = "connection"
    login_refused = "login_refused"
    password_rotation_failed = "password_rotation_failed"
    update_refused = "update_refused"
    settings_invalid = "settings_invalid"
    no_primary = "no_primary"
    no_phone = "no_phone"


@dataclass(frozen=True)
class Receiver:
    """The SECONDARY who took the on-call number over from the PRIMARY."""

    member_id: uuid.UUID
    name: str


@dataclass(frozen=True)
class ForwardingTarget:
    """Who should receive the on-call calls for one duty day: the PRIMARY
    (`member_*`), or while a handover holds its `receiver`, whose `number`
    it then is."""

    day: date
    member_id: uuid.UUID | None
    member_name: str | None
    number: str | None
    receiver: Receiver | None = None

    @property
    def holder_id(self) -> uuid.UUID | None:
        """Whose phone rings."""
        return self.receiver.member_id if self.receiver is not None else self.member_id

    @property
    def holder_name(self) -> str | None:
        return self.receiver.name if self.receiver is not None else self.member_name

    @property
    def missing(self) -> ForwardingFailure | None:
        if self.member_name is None:
            return ForwardingFailure.no_primary
        if self.number is None:
            return ForwardingFailure.no_phone
        return None

    @property
    def alert_token(self) -> str:
        """One daily target as a short dedup key that carries no number."""
        identity = f"{self.number}|{self.holder_id}|{self.holder_name}".encode()
        return f"{self.day.isoformat()}:{hashlib.sha256(identity).hexdigest()[:16]}"

    @property
    def failure_alert_key(self) -> str:
        """What the state records once the failure alert for this target went out."""
        return f"forwarding-failed:{self.alert_token}"


@dataclass(frozen=True)
class ForwardingAccount:
    """One consistent snapshot of the WCO settings and decrypted passwords."""

    mode: ForwardingMode
    base_url: str
    vpbx_number: str
    username: str
    wco_user_id: str
    passwords: Passwords = field(repr=False)
    #: The same passwords as stored, encrypted: what the row must still hold
    #: when the pass writes a password back.
    stored: Passwords = field(repr=False)
    credentials_invalid_since: datetime | None = None


@dataclass
class ForwardingAttempt:
    """A claimed network attempt, copied out of its database transaction."""

    account: ForwardingAccount
    target: ForwardingTarget
    lease_until: datetime


@dataclass(frozen=True)
class RecordedForwarding:
    """An outcome committed by the worker and ready to be measured."""

    outcome: ForwardingOutcome
    attempts: int
    rotated: bool = False


def forwarding_day(now_local: datetime, reminder_hour: int) -> date:
    """The duty day whose PRIMARY owns the line at ``now_local``."""
    if now_local.hour >= reminder_hour:
        return now_local.date()
    return now_local.date() - timedelta(days=1)


def duty_day_end(day: date, reminder_hour: int) -> datetime:
    """When the duty day ends: the next day's reminder hour, when the number
    passes to the next PRIMARY."""
    return datetime.combine(day + timedelta(days=1), time(reminder_hour), BUSINESS_TIMEZONE)


def _member(duties: dict[Slot, Duty], day: date, role: AssignmentRole) -> uuid.UUID | None:
    duty = duties.get((day, role))
    return duty.member_id if duty is not None else None


def handover_end(
    handover: NumberHandover, day: date, duties: dict[Slot, Duty], now: datetime
) -> HandoverEnd | None:
    """Why an open handover no longer holds on `day`, None while it does: it
    holds until its `until` within the day it was made on, and only while
    the two people are still that day's PRIMARY and SECONDARY."""
    if handover.day != day or now >= handover.until:
        return HandoverEnd.expired
    if (handover.from_member_id, handover.to_member_id) != (
        _member(duties, day, AssignmentRole.primary),
        _member(duties, day, AssignmentRole.secondary),
    ):
        return HandoverEnd.roster_change
    return None


async def settle_handover(
    day: date, duties: dict[Slot, Duty], now: datetime, ports: HandoverPorts
) -> NumberHandover | None:
    """The open handover while it holds; one that no longer does is ended
    here, and both of its people are told when a roster change ended it.
    Its end is recorded at `until` when the time ran out, so a pass that
    comes late does not stretch it."""
    handover = await ports.handovers.open()
    if handover is None:
        return None
    reason = handover_end(handover, day, duties, now)
    if reason is None:
        return handover
    at = min(now, handover.until) if reason is HandoverEnd.expired else now
    if await ports.handovers.end(handover, reason, at=at, by_user_id=None):
        ports.journal.ended(handover, reason)
        if reason is HandoverEnd.roster_change:
            primary = duties.get((day, AssignmentRole.primary))
            await ports.journal.ended_by_roster_change(
                handover, primary.assignee_name if primary is not None else None
            )
    return None


async def target_of(
    day: date,
    duties: dict[Slot, Duty],
    handover: NumberHandover | None,
    contacts: ForwardingContacts,
) -> ForwardingTarget | None:
    """Map the PRIMARY in force on `day` to their stored number, or to the
    receiver's while `handover` holds and the receiver has one; None while no
    roster was ever published, when there is nobody to switch to yet."""
    duty = duties.get((day, AssignmentRole.primary))
    if duty is None:
        if not await contacts.roster_published():
            return None
        return ForwardingTarget(day, None, None, None)
    if handover is not None:
        number = await contacts.phone(handover.to_member_id)
        if number is not None:
            receiver = Receiver(handover.to_member_id, handover.to_name)
            return ForwardingTarget(day, duty.member_id, duty.assignee_name, number, receiver)
    number = await contacts.phone(duty.member_id) if duty.member_id is not None else None
    return ForwardingTarget(day, duty.member_id, duty.assignee_name, number)


async def desired_target(
    now_local: datetime,
    reminder_hour: int,
    roster: PublishedRoster,
    contacts: ForwardingContacts,
    handovers: HandoverPorts,
) -> ForwardingTarget | None:
    """Where the number should ring at `now_local`, ending first a handover
    that no longer holds."""
    day = forwarding_day(now_local, reminder_hour)
    duties = await roster.duties_in_force(day, day)
    handover = await settle_handover(day, duties, now_local, handovers)
    return await target_of(day, duties, handover, contacts)


def wco_number(target: ForwardingTarget) -> str:
    """The WCO mapping is the identity: ``+48500500500`` stays unchanged."""
    if target.number is None:
        raise ValueError("the forwarding target has no number")
    return target.number
