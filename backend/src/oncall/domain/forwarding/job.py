"""Desired state and value objects for the WCO forwarding worker.

The duty day changes at the handover reminder hour. Before that hour the
previous day's PRIMARY still receives calls; from that hour onward today's
PRIMARY does. The person's stored Polish E.164 number is sent to WCO exactly
as stored.
"""

import hashlib
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from enum import StrEnum

from oncall.domain.forwarding.models import ForwardingMode, ForwardingOutcome
from oncall.domain.forwarding.passwords import Passwords
from oncall.domain.forwarding.ports import ForwardingContacts
from oncall.domain.ports import PublishedRoster
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
class ForwardingTarget:
    """Who should receive the on-call calls for one duty day."""

    day: date
    member_id: uuid.UUID | None
    member_name: str | None
    number: str | None

    @property
    def missing(self) -> ForwardingFailure | None:
        if self.member_name is None:
            return ForwardingFailure.no_primary
        if self.number is None:
            return ForwardingFailure.no_phone
        return None

    @property
    def alert_token(self) -> str:
        """A compact identity for one daily target, safe for a dedup key."""
        if self.number is not None:
            target = self.number
        elif self.member_id is not None:
            target = str(self.member_id)
        elif self.member_name is not None:
            target = hashlib.sha256(self.member_name.encode()).hexdigest()[:16]
        else:
            target = "none"
        return f"{self.day.isoformat()}:{target}"


@dataclass(frozen=True)
class ForwardingAccount:
    """One consistent snapshot of the WCO settings and decrypted passwords."""

    settings_id: uuid.UUID
    mode: ForwardingMode
    base_url: str
    vpbx_number: str
    username: str
    wco_user_id: str
    passwords: Passwords = field(repr=False)
    current_token: str = field(repr=False, default="")
    pending_token: str | None = field(repr=False, default=None)
    credentials_invalid_since: datetime | None = None


@dataclass
class ForwardingAttempt:
    """A claimed network attempt, copied out of its database transaction."""

    account: ForwardingAccount
    target: ForwardingTarget
    lease_until: datetime
    attempts: int


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


async def desired_target(
    now_local: datetime,
    reminder_hour: int,
    roster: PublishedRoster,
    contacts: ForwardingContacts,
) -> ForwardingTarget:
    """Map the PRIMARY in force now to their stored number."""
    day = forwarding_day(now_local, reminder_hour)
    duty = (await roster.duties_in_force(day, day)).get((day, AssignmentRole.primary))
    if duty is None:
        return ForwardingTarget(day, None, None, None)
    number = await contacts.phone(duty.member_id) if duty.member_id is not None else None
    return ForwardingTarget(day, duty.member_id, duty.assignee_name, number)


def wco_number(target: ForwardingTarget) -> str:
    """The WCO mapping is the identity: ``+48500500500`` stays unchanged."""
    if target.number is None:
        raise ValueError("the forwarding target has no number")
    return target.number
