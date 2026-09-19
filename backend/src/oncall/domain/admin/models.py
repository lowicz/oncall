"""What the administration use cases take and give back."""

import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from oncall.domain.accounts import Account as Account
from oncall.domain.roster import Slot
from oncall.domain.team import Actor
from oncall.domain.vocabulary import AccountTokenKind, AssignmentRole, AuthSource, UserRole

#: The fields of an account that describe the person. For a directory (LDAP)
#: account they come from AD and are never edited here.
IDENTITY_FIELDS = frozenset({"personnel_number", "first_name", "last_name", "email"})
ACTIVATION_LINK_LIFETIME = timedelta(hours=24)
RESET_LINK_LIFETIME = timedelta(hours=1)
#: How many blocking slots a refusal names; the rest are left for a later try.
LISTED_SLOTS = 20


@dataclass(frozen=True)
class NewAccount:
    actor: Actor
    username: str
    personnel_number: str | None
    first_name: str
    last_name: str
    email: str | None
    phone: str | None
    role: UserRole


@dataclass(frozen=True)
class AccountRecord:
    """A local account as it is stored: names trimmed, no password yet."""

    username: str
    personnel_number: str | None
    first_name: str
    last_name: str
    email: str | None
    phone: str | None
    role: UserRole
    auth_source: AuthSource = AuthSource.local


@dataclass(frozen=True)
class AccountChange:
    actor: Actor
    account_id: uuid.UUID
    #: Only the fields the administrator sent; an explicit ``None`` clears one.
    changes: Mapping[str, Any]


@dataclass(frozen=True)
class AccountAction:
    actor: Actor
    account_id: uuid.UUID


@dataclass(frozen=True)
class IssuedToken:
    """A one-time account token. The raw value exists only here: it is shown
    to the administrator once and stored as a hash."""

    raw: str
    kind: AccountTokenKind
    expires_at: datetime


@dataclass(frozen=True)
class AccountCreated:
    account: Account
    activation: IssuedToken


@dataclass(frozen=True)
class EligibilityPeriod:
    id: uuid.UUID
    member_id: uuid.UUID
    role: AssignmentRole
    starts_on: date
    ends_on: date | None

    def covers(self, day: date) -> bool:
        return self.starts_on <= day and (self.ends_on is None or self.ends_on >= day)


@dataclass(frozen=True)
class RotationMember:
    id: uuid.UUID
    user_id: uuid.UUID | None
    display_name: str
    active_from: date
    active_until: date | None
    eligibility: tuple[EligibilityPeriod, ...] = ()

    def contains(self, starts_on: date, ends_on: date | None) -> bool:
        """Whether a period fits inside this membership. An open-ended period
        never fits a membership that ends."""
        return not (
            starts_on < self.active_from
            or (self.active_until is not None and (ends_on is None or ends_on > self.active_until))
        )


@dataclass(frozen=True)
class Enrolment:
    actor: Actor
    account_id: uuid.UUID
    active_from: date


@dataclass(frozen=True)
class MembershipChange:
    actor: Actor
    member_id: uuid.UUID
    changes: Mapping[str, Any]


@dataclass(frozen=True)
class EligibilityGrant:
    actor: Actor
    member_id: uuid.UUID
    role: AssignmentRole
    starts_on: date
    ends_on: date | None


@dataclass(frozen=True)
class NewEligibilityPeriod:
    member_id: uuid.UUID
    role: AssignmentRole
    starts_on: date
    ends_on: date | None


@dataclass(frozen=True)
class EligibilityChange:
    actor: Actor
    eligibility_id: uuid.UUID
    changes: Mapping[str, Any]


@dataclass(frozen=True)
class EligibilityRevocation:
    actor: Actor
    eligibility_id: uuid.UUID


def slot_list(slots: list[Slot]) -> str:
    return ", ".join(f"{day.isoformat()} ({role.value})" for day, role in slots)


#: The audit action a successful login writes. Browsing leaves it out unless
#: asked, because it outnumbers everything else in the trail.
LOGIN_ACTION = "auth.login"


@dataclass(frozen=True)
class AuditQuery:
    action: str | None = None
    entity_type: str | None = None
    actor: str | None = None
    text: str | None = None
    starts_on: date | None = None
    ends_on: date | None = None
    include_logins: bool = False
    limit: int = 100
    offset: int = 0


@dataclass(frozen=True)
class AuditFilter:
    """The query as the audit trail runs it."""

    action: str | None
    entity_type: str | None
    actor: str | None
    text: str | None
    starts_on: date | None
    ends_on: date | None
    excluded_action: str | None
    limit: int
    offset: int


@dataclass(frozen=True)
class AuditEntry:
    id: uuid.UUID
    occurred_at: datetime
    actor_label: str
    action: str
    entity_type: str | None
    entity_id: str | None
    summary: str
    details: dict | None


@dataclass(frozen=True)
class AuditPage:
    entries: list[AuditEntry]
    #: Whether login events were left out, so an empty search is explained.
    logins_excluded: bool
