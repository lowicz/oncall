"""What administration needs from the world around it, one bundle per consumer:
account administration, membership administration and eligibility
administration. The audit query and the rotation listing each take their one
protocol directly.
"""

import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any, Protocol

from oncall.domain.admin.models import (
    Account,
    AccountRecord,
    AdministeredAccount,
    AuditEntry,
    AuditFilter,
    EligibilityPeriod,
    IssuedToken,
    NewEligibilityPeriod,
    RotationMember,
)
from oncall.domain.roster import Slot
from oncall.domain.vocabulary import AccountTokenKind, AssignmentRole


class AccountBook(Protocol):
    async def accounts(self) -> list[AdministeredAccount]:
        """Every account, by last name and first name."""
        ...

    async def account(self, account_id: uuid.UUID) -> AdministeredAccount | None:
        """The account as it is stored now."""
        ...

    async def active_admin_count(self) -> int:
        """How many administrators can still sign in.

        The answer holds until the unit of work ends: a concurrent demotion or
        deletion of an administrator waits here instead of racing past the
        check, so the last one is never removed twice over.
        """
        ...

    async def open_account(self, record: AccountRecord) -> Account:
        """Store a new account. A login or personnel number claimed meanwhile
        by a concurrent request raises the same error the check would have."""
        ...

    async def change_account(
        self, account_id: uuid.UUID, changes: Mapping[str, Any]
    ) -> Account: ...

    async def close_account(self, account_id: uuid.UUID) -> None:
        """Remove the account and its personal data.

        Raises `AccountStillReferenced` when other records still point at it.
        """
        ...

    async def issue_token(
        self, account_id: uuid.UUID, kind: AccountTokenKind, lifetime: timedelta
    ) -> IssuedToken:
        """A fresh one-time token; older unused tokens of that kind stop working."""
        ...


class ClaimedIdentifiers(Protocol):
    """Logins, e-mail addresses and personnel numbers already in use."""

    async def username_taken(self, username: str) -> bool:
        """Case-insensitive."""
        ...

    async def email_taken(self, email: str, *, other_than: uuid.UUID | None = None) -> bool:
        """Case-insensitive."""
        ...

    async def personnel_number_taken(
        self, personnel_number: str, *, other_than: uuid.UUID | None = None
    ) -> bool: ...


class MemberNames(Protocol):
    async def rename_member(self, member_id: uuid.UUID, display_name: str) -> None:
        """Carry an account's new name to its member and the duty labels."""
        ...


class AccountJournal(Protocol):
    """The audit trail of account administration, written in the
    administrator's name."""

    async def account_created(self, account: Account) -> None: ...

    async def account_updated(
        self, account: Account, *, fields: list[str], before: dict[str, str | None]
    ) -> None: ...

    async def reset_link_issued(self, account: Account) -> None: ...

    async def activation_link_issued(self, account: Account) -> None: ...

    async def account_deleted(self, account: Account) -> None: ...


@dataclass(frozen=True)
class AccountAdministrationPorts:
    accounts: AccountBook
    identifiers: ClaimedIdentifiers
    members: MemberNames
    journal: AccountJournal


class RotationDirectory(Protocol):
    async def members(self) -> list[RotationMember]:
        """Everyone in the rotation, by name."""
        ...


class HeldMembers(Protocol):
    """What both membership and eligibility rules check a member against."""

    async def member_for_change(self, member_id: uuid.UUID) -> RotationMember | None:
        """The member, held until the unit of work ends, so concurrent changes
        to one person's membership or eligibility are checked one at a time."""
        ...

    async def published_duties(
        self,
        member_id: uuid.UUID,
        *,
        role: AssignmentRole | None = None,
        before: date | None = None,
        after: date | None = None,
        limit: int | None = None,
    ) -> list[Slot]:
        """The member's published slots dated before ``before`` or after
        ``after``, by date."""
        ...


class AccountLookup(Protocol):
    async def account(self, account_id: uuid.UUID) -> Account | None:
        """The account as it is stored now."""
        ...


class MembershipBook(HeldMembers, Protocol):
    async def member(self, member_id: uuid.UUID) -> RotationMember | None: ...

    async def account_is_enrolled(self, account_id: uuid.UUID) -> bool: ...

    async def enrol(self, account: Account, active_from: date) -> RotationMember:
        """Raises `AccountAlreadyInRotation` when a concurrent request enrolled
        the account first."""
        ...

    async def change_membership(
        self, member_id: uuid.UUID, changes: Mapping[str, Any]
    ) -> RotationMember: ...


class MembershipJournal(Protocol):
    """The audit trail of rotation membership, written in the administrator's
    name."""

    async def member_enrolled(self, member: RotationMember) -> None: ...

    async def membership_changed(self, member: RotationMember, *, fields: list[str]) -> None: ...


@dataclass(frozen=True)
class MembershipAdministrationPorts:
    accounts: AccountLookup
    rotation: MembershipBook
    journal: MembershipJournal


class EligibilityBook(HeldMembers, Protocol):
    async def period(self, eligibility_id: uuid.UUID) -> EligibilityPeriod | None:
        """The period as it is stored now."""
        ...

    async def periods(
        self, member_id: uuid.UUID, role: AssignmentRole
    ) -> list[EligibilityPeriod]: ...

    async def overlapping_period_exists(
        self,
        member_id: uuid.UUID,
        role: AssignmentRole,
        starts_on: date,
        ends_on: date | None,
        *,
        other_than: uuid.UUID | None = None,
    ) -> bool: ...

    async def grant(self, period: NewEligibilityPeriod) -> EligibilityPeriod: ...

    async def change_period(
        self, eligibility_id: uuid.UUID, changes: Mapping[str, Any]
    ) -> EligibilityPeriod: ...

    async def revoke(self, eligibility_id: uuid.UUID) -> None: ...


class EligibilityJournal(Protocol):
    """The audit trail of eligibility periods, written in the administrator's
    name."""

    async def eligibility_granted(
        self, member: RotationMember, period: EligibilityPeriod
    ) -> None: ...

    async def eligibility_changed(
        self, member: RotationMember, period: EligibilityPeriod, *, fields: list[str]
    ) -> None: ...

    async def eligibility_revoked(
        self, member: RotationMember, period: EligibilityPeriod
    ) -> None: ...


@dataclass(frozen=True)
class EligibilityAdministrationPorts:
    rotation: EligibilityBook
    journal: EligibilityJournal


class AuditTrail(Protocol):
    async def entries(self, query: AuditFilter) -> list[AuditEntry]:
        """Newest first."""
        ...
