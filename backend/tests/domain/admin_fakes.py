"""In-memory administration ports."""

import uuid
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime

from oncall.domain.admin.models import (
    Account,
    AccountRecord,
    AdministeredAccount,
    AuditEntry,
    AuditFilter,
    EligibilityPeriod,
    IssuedToken,
    NewEligibilityPeriod,
    PendingActivation,
    RotationMember,
)
from oncall.domain.admin.ports import (
    AccountAdministrationPorts,
    EligibilityAdministrationPorts,
    MembershipAdministrationPorts,
)
from oncall.domain.roster import Slot
from oncall.domain.vocabulary import AccountTokenKind, AssignmentRole, AuthSource, UserRole
from tests.domain.fakes import FakeJournal


def account(
    username: str,
    *,
    role: UserRole = UserRole.member,
    auth_source: AuthSource = AuthSource.local,
    is_active: bool = True,
    email: str | None = None,
    personnel_number: str | None = None,
    pending_activation: PendingActivation | None = None,
) -> AdministeredAccount:
    first, _, last = username.title().partition(" ")
    return AdministeredAccount(
        id=uuid.uuid4(),
        username=username.replace(" ", "."),
        personnel_number=personnel_number,
        first_name=first,
        last_name=last,
        auth_source=auth_source,
        role=role,
        email=email,
        phone=None,
        is_active=is_active,
        created_at=datetime.now(UTC),
        pending_activation=pending_activation,
    )


class FakeAccounts:
    def __init__(self) -> None:
        self.by_id: dict[uuid.UUID, AdministeredAccount] = {}
        self.tokens: list[IssuedToken] = []
        self.referenced: set[uuid.UUID] = set()
        self.admin_counts = 0

    def put(self, item: AdministeredAccount) -> AdministeredAccount:
        self.by_id[item.id] = item
        return item

    async def accounts(self):
        return sorted(self.by_id.values(), key=lambda item: (item.last_name, item.first_name))

    async def account(self, account_id):
        return self.by_id.get(account_id)

    async def username_taken(self, username):
        return any(item.username.lower() == username.lower() for item in self.by_id.values())

    async def email_taken(self, email, *, other_than=None):
        return any(
            item.email and item.email.lower() == email.lower() and item.id != other_than
            for item in self.by_id.values()
        )

    async def personnel_number_taken(self, personnel_number, *, other_than=None):
        return any(
            item.personnel_number == personnel_number and item.id != other_than
            for item in self.by_id.values()
        )

    async def active_admin_count(self):
        self.admin_counts += 1
        return sum(item.is_active_admin for item in self.by_id.values())

    async def open_account(self, record: AccountRecord):
        return self.put(
            AdministeredAccount(
                id=uuid.uuid4(),
                username=record.username,
                personnel_number=record.personnel_number,
                first_name=record.first_name,
                last_name=record.last_name,
                auth_source=record.auth_source,
                role=record.role,
                email=record.email,
                phone=record.phone,
                is_active=True,
                created_at=datetime.now(UTC),
                pending_activation=PendingActivation(link_expires_at=None),
            )
        )

    async def change_account(self, account_id, changes):
        return self.put(replace(self.by_id[account_id], **changes))

    async def close_account(self, account_id):
        from oncall.domain.admin.errors import AccountStillReferenced

        if account_id in self.referenced:
            raise AccountStillReferenced(account_id)
        del self.by_id[account_id]

    async def issue_token(self, account_id, kind, lifetime):
        token = IssuedToken(f"raw-{len(self.tokens)}", kind, datetime.now(UTC) + lifetime)
        self.tokens.append(token)
        owner = self.by_id[account_id]
        if kind == AccountTokenKind.activation and owner.pending_activation is not None:
            self.put(replace(owner, pending_activation=PendingActivation(token.expires_at)))
        return token


class FakeRotation:
    def __init__(self) -> None:
        self.members: dict[uuid.UUID, RotationMember] = {}
        self.periods_by_id: dict[uuid.UUID, EligibilityPeriod] = {}
        self.duties: dict[uuid.UUID, list[Slot]] = {}
        self.renamed: list[tuple[uuid.UUID, str]] = []
        self.held: list[uuid.UUID] = []

    def enrolled(self, owner: Account | None, active_from: date, active_until=None):
        item = RotationMember(
            id=uuid.uuid4(),
            user_id=owner.id if owner else None,
            display_name=owner.display_name if owner else "Bez Konta",
            active_from=active_from,
            active_until=active_until,
        )
        self.members[item.id] = item
        return item

    def granted(self, member: RotationMember, role, starts_on, ends_on=None) -> EligibilityPeriod:
        period = EligibilityPeriod(uuid.uuid4(), member.id, role, starts_on, ends_on)
        self.periods_by_id[period.id] = period
        return period

    def _with_periods(self, item: RotationMember) -> RotationMember:
        periods = tuple(p for p in self.periods_by_id.values() if p.member_id == item.id)
        return replace(item, eligibility=periods)

    async def member(self, member_id):
        item = self.members.get(member_id)
        return self._with_periods(item) if item else None

    async def member_for_change(self, member_id):
        self.held.append(member_id)
        return await self.member(member_id)

    async def account_is_enrolled(self, account_id):
        return any(item.user_id == account_id for item in self.members.values())

    async def enrol(self, owner, active_from):
        return self.enrolled(owner, active_from)

    async def change_membership(self, member_id, changes):
        self.members[member_id] = replace(self.members[member_id], **changes)
        return await self.member(member_id)

    async def rename_member(self, member_id, display_name):
        self.renamed.append((member_id, display_name))

    async def period(self, eligibility_id):
        return self.periods_by_id.get(eligibility_id)

    async def periods(self, member_id, role):
        return [
            item
            for item in self.periods_by_id.values()
            if item.member_id == member_id and item.role == role
        ]

    async def overlapping_period_exists(
        self, member_id, role, starts_on, ends_on, *, other_than=None
    ):
        return any(
            p.id != other_than
            and (p.ends_on is None or p.ends_on >= starts_on)
            and (ends_on is None or p.starts_on <= ends_on)
            for p in await self.periods(member_id, role)
        )

    async def grant(self, period: NewEligibilityPeriod):
        return self.granted(
            self.members[period.member_id], period.role, period.starts_on, period.ends_on
        )

    async def change_period(self, eligibility_id, changes):
        self.periods_by_id[eligibility_id] = replace(self.periods_by_id[eligibility_id], **changes)
        return self.periods_by_id[eligibility_id]

    async def revoke(self, eligibility_id):
        del self.periods_by_id[eligibility_id]

    async def published_duties(self, member_id, *, role=None, before=None, after=None, limit=None):
        if before is None and after is None:
            return []
        slots = sorted(
            slot
            for slot in self.duties.get(member_id, [])
            if (role is None or slot[1] == role)
            and (
                (before is not None and slot[0] < before) or (after is not None and slot[0] > after)
            )
        )
        return slots[:limit] if limit is not None else slots


class FakeAuditTrail:
    def __init__(self, *entries: AuditEntry) -> None:
        self.stored = list(entries)
        self.queries: list[AuditFilter] = []

    async def entries(self, query: AuditFilter):
        self.queries.append(query)
        return [
            item
            for item in self.stored
            if item.action != query.excluded_action
            and (not query.action or item.action == query.action)
        ][query.offset : query.offset + query.limit]


@dataclass
class AdminWorld:
    accounts: FakeAccounts = field(default_factory=FakeAccounts)
    rotation: FakeRotation = field(default_factory=FakeRotation)
    journal: FakeJournal = field(default_factory=FakeJournal)

    @property
    def account_administration(self) -> AccountAdministrationPorts:
        return AccountAdministrationPorts(
            accounts=self.accounts,
            identifiers=self.accounts,
            members=self.rotation,
            journal=self.journal,
        )

    @property
    def membership_administration(self) -> MembershipAdministrationPorts:
        return MembershipAdministrationPorts(
            accounts=self.accounts, rotation=self.rotation, journal=self.journal
        )

    @property
    def eligibility_administration(self) -> EligibilityAdministrationPorts:
        return EligibilityAdministrationPorts(rotation=self.rotation, journal=self.journal)


def slot(day: date, role: AssignmentRole = AssignmentRole.primary) -> Slot:
    return (day, role)
