"""In-memory ports for exercising the use cases without a database or FastAPI."""

import uuid
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta

from oncall.domain.availability.models import AvailabilityEntry, NewAvailabilityEntry
from oncall.domain.availability.ports import AvailabilityPorts
from oncall.domain.overrides.ports import OverridePorts
from oncall.domain.roster import Duty, ScheduleRef, Slot
from oncall.domain.swaps.models import NewSwapRequest, SwapRequest
from oncall.domain.swaps.ports import SwapPorts
from oncall.domain.team import Actor, AvailabilityPeriod, Member, RolePeriod
from oncall.domain.vocabulary import (
    AssignmentRole,
    AvailabilityKind,
    LateShiftAnchor,
    RotationMode,
    ScheduleStatus,
    SwapStatus,
    UserRole,
)
from oncall.fairness import EligibilityPeriod, FairnessDuty, FairnessMemberInput


def actor(role: UserRole = UserRole.member, user_id: uuid.UUID | None = None) -> Actor:
    return Actor(user_id=user_id or uuid.uuid4(), display_name=f"{role.value} actor", role=role)


def member(
    name: str,
    *,
    user_id: uuid.UUID | None = None,
    has_account: bool = True,
    roles: Iterable[AssignmentRole] = tuple(AssignmentRole),
    unavailable: Iterable[date] = (),
    availability: Iterable[AvailabilityPeriod] = (),
) -> Member:
    since = date.today() - timedelta(days=400)
    return Member(
        id=uuid.uuid4(),
        display_name=name,
        user_id=(user_id or uuid.uuid4()) if has_account else None,
        active_from=since,
        active_until=None,
        eligibility=tuple(RolePeriod(role, since, None) for role in roles),
        availability=tuple(
            [AvailabilityPeriod(AvailabilityKind.unavailable, day, day) for day in unavailable]
            + list(availability)
        ),
    )


class FakeTeam:
    def __init__(self, *members: Member, approvers: Iterable[uuid.UUID] = ()) -> None:
        self.by_id = {item.id: item for item in members}
        self.approvers = set(approvers)

    def add(self, item: Member) -> Member:
        self.by_id[item.id] = item
        return item

    async def member_for_account(self, user_id):
        return next((item for item in self.by_id.values() if item.user_id == user_id), None)

    async def member(self, member_id):
        return self.by_id.get(member_id)

    async def member_named(self, display_name):
        return next(
            (item for item in self.by_id.values() if item.display_name == display_name), None
        )

    async def members(self, member_ids):
        return {item: self.by_id[item] for item in member_ids if item in self.by_id}

    async def colleagues_of(self, member_id):
        return sorted(
            (item for item in self.by_id.values() if item.id != member_id),
            key=lambda item: item.display_name,
        )

    async def display_names(self, member_ids):
        return {item: self.by_id[item].display_name for item in member_ids if item in self.by_id}

    async def another_active_approver_exists(self, user_id):
        return bool(self.approvers - {user_id})


@dataclass
class FakeSchedule:
    id: uuid.UUID
    status: ScheduleStatus = ScheduleStatus.published
    version: int = 1
    slots: dict[Slot, Duty] = field(default_factory=dict)


class FakeRoster:
    """One published schedule is the roster in force; its version is compared
    and advanced atomically, which in memory simply means at once."""

    def __init__(self) -> None:
        self.schedule_ref = FakeSchedule(id=uuid.uuid4())
        self.schedules = {self.schedule_ref.id: self.schedule_ref}
        self.handed_over: list[tuple[Slot, uuid.UUID]] = []
        self.handover_reads: list[Slot] = []

    def assign(self, day: date, role: AssignmentRole, holder: Member | str) -> Duty:
        duty = Duty(
            service_date=day,
            role=role,
            member_id=holder.id if isinstance(holder, Member) else None,
            assignee_name=holder.display_name if isinstance(holder, Member) else holder,
            is_override=False,
            schedule_id=self.schedule_ref.id,
        )
        self.schedule_ref.slots[(day, role)] = duty
        return duty

    async def duties_in_force(self, starts_on, ends_on):
        return {
            slot: duty
            for schedule in self.schedules.values()
            if schedule.status == ScheduleStatus.published
            for slot, duty in schedule.slots.items()
            if starts_on <= slot[0] <= ends_on
        }

    async def schedule(self, schedule_id):
        found = self.schedules.get(schedule_id)
        return ScheduleRef(found.id, found.status, found.version) if found else None

    async def latest_publication_covering(self, day):
        found = self.schedule_ref
        if found.status != ScheduleStatus.published:
            return None
        return ScheduleRef(found.id, found.status, found.version)

    async def duty(self, schedule_id, slot):
        found = self.schedules.get(schedule_id)
        return found.slots.get(slot) if found else None

    async def duty_for_handover(self, schedule_id, slot):
        self.handover_reads.append(slot)
        return await self.duty(schedule_id, slot)

    async def advance_version(self, schedule_id, *, expected_version, only_if_published):
        found = self.schedules.get(schedule_id)
        if found is None:
            return False
        if expected_version is not None and found.version != expected_version:
            return False
        if only_if_published and found.status != ScheduleStatus.published:
            return False
        found.version += 1
        return True

    async def hand_over(self, schedule_id, slots, to):
        found = self.schedules[schedule_id]
        for slot in slots:
            found.slots[slot] = Duty(slot[0], slot[1], to.id, to.display_name, True, schedule_id)
            self.handed_over.append((slot, to.id))


class FakePolicy:
    def __init__(
        self,
        anchor: LateShiftAnchor = LateShiftAnchor.secondary,
        mode: RotationMode = RotationMode.hybrid,
    ) -> None:
        self.anchor = anchor
        self.mode = mode

    async def late_shift_anchor(self):
        return self.anchor

    async def rotation_mode(self):
        return self.mode


class FakeFairness:
    def __init__(self, team: FakeTeam, roster: FakeRoster) -> None:
        self.team = team
        self.roster = roster

    async def balance_inputs(self, window_start, window_end):
        members = [
            FairnessMemberInput(
                id=item.id,
                display_name=item.display_name,
                active_from=item.active_from,
                active_until=item.active_until,
                eligibility={
                    role: [
                        EligibilityPeriod(period.starts_on, period.ends_on)
                        for period in item.eligibility
                        if period.role == role
                    ]
                    for role in AssignmentRole
                },
            )
            for item in self.team.by_id.values()
        ]
        duties = [
            FairnessDuty(duty.service_date, duty.role, duty.assignee_name, duty.member_id)
            for duty in (await self.roster.duties_in_force(window_start, window_end)).values()
        ]
        return members, duties


class FakeSwapRequests:
    def __init__(self) -> None:
        self.by_id: dict[uuid.UUID, SwapRequest] = {}
        self.decisions: list[SwapRequest] = []

    async def has_active_request_for(self, slot):
        return any(item.active and slot in item.moves for item in self.by_id.values())

    async def add(self, request: NewSwapRequest):
        stored = SwapRequest(
            id=uuid.uuid4(),
            schedule_id=request.schedule_id,
            service_date=request.service_date,
            role=request.role,
            requester_member_id=request.requester_member_id,
            replacement_member_id=request.replacement_member_id,
            status=request.status,
            schedule_version=request.schedule_version,
            note=request.note,
            decision_note=None,
            created_at=datetime.now(UTC),
            slots=request.slots,
        )
        self.by_id[stored.id] = stored
        return stored

    def put(self, request: SwapRequest) -> SwapRequest:
        self.by_id[request.id] = request
        return request

    async def take_for_decision(self, swap_id):
        return self.by_id.get(swap_id)

    async def record_decision(self, request):
        self.by_id[request.id] = request
        self.decisions.append(request)

    async def requests(self, *, involving, statuses, limit, offset):
        items = [
            item
            for item in self.by_id.values()
            if (
                involving is None
                or involving in (item.requester_member_id, item.replacement_member_id)
            )
            and (not statuses or item.status in statuses)
        ]
        items.sort(key=lambda item: item.created_at, reverse=True)
        return items[offset : offset + limit]


class FakeJournal:
    """Records every journal call as (event, keyword arguments)."""

    def __init__(self) -> None:
        self.events: list[tuple[str, dict]] = []

    def __getattr__(self, name: str):
        async def record(*args, **kwargs):
            self.events.append((name, {"args": args, **kwargs}))

        return record

    @property
    def names(self) -> list[str]:
        return [name for name, _ in self.events]


class FakeLedger:
    def __init__(self) -> None:
        self.by_id: dict[uuid.UUID, AvailabilityEntry] = {}
        self.pending: NewAvailabilityEntry | None = None
        self.removed: list[uuid.UUID] = []

    def put(self, entry: AvailabilityEntry) -> AvailabilityEntry:
        self.by_id[entry.id] = entry
        return entry

    async def overlapping_entry(self, member_id, starts_on, ends_on):
        return next(
            (
                item
                for item in self.by_id.values()
                if item.member_id == member_id
                and item.starts_on <= ends_on
                and item.ends_on >= starts_on
            ),
            None,
        )

    async def record(self, entry):
        self.pending = entry

    async def recorded_entry(self):
        assert self.pending is not None
        stored = AvailabilityEntry(
            id=uuid.uuid4(),
            member_id=self.pending.member_id,
            kind=self.pending.kind,
            starts_on=self.pending.starts_on,
            ends_on=self.pending.ends_on,
            note=self.pending.note,
            created_at=datetime.now(UTC),
            created_by_user_id=self.pending.created_by_user_id,
            created_by_name="filer",
        )
        return self.put(stored)

    async def entries(self, member_id, starts_on, ends_on):
        return sorted(
            (item for item in self.by_id.values() if item.member_id == member_id),
            key=lambda item: item.starts_on,
        )

    async def entry_to_withdraw(self, member_id, entry_id):
        found = self.by_id.get(entry_id)
        return found if found is not None and found.member_id == member_id else None

    async def remove(self, entry_id):
        self.by_id.pop(entry_id, None)
        self.removed.append(entry_id)


@dataclass
class World:
    """Every fake wired together, plus the ports bundles the use cases take."""

    team: FakeTeam = field(default_factory=FakeTeam)
    roster: FakeRoster = field(default_factory=FakeRoster)
    policy: FakePolicy = field(default_factory=FakePolicy)
    requests: FakeSwapRequests = field(default_factory=FakeSwapRequests)
    journal: FakeJournal = field(default_factory=FakeJournal)
    ledger: FakeLedger = field(default_factory=FakeLedger)

    @property
    def swaps(self) -> SwapPorts:
        return SwapPorts(
            team=self.team,
            roster=self.roster,
            policy=self.policy,
            requests=self.requests,
            journal=self.journal,
            fairness=FakeFairness(self.team, self.roster),
        )

    @property
    def availability(self) -> AvailabilityPorts:
        return AvailabilityPorts(
            team=self.team, roster=self.roster, ledger=self.ledger, journal=self.journal
        )

    @property
    def overrides(self) -> OverridePorts:
        return OverridePorts(
            team=self.team, roster=self.roster, policy=self.policy, journal=self.journal
        )


def pending_swap(
    world: World,
    requester: Member,
    replacement: Member,
    day: date,
    *,
    role: AssignmentRole = AssignmentRole.primary,
    status: SwapStatus = SwapStatus.pending_coordinator,
) -> SwapRequest:
    return world.requests.put(
        SwapRequest(
            id=uuid.uuid4(),
            schedule_id=world.roster.schedule_ref.id,
            service_date=day,
            role=role,
            requester_member_id=requester.id,
            replacement_member_id=replacement.id,
            status=status,
            schedule_version=world.roster.schedule_ref.version,
            note=None,
            decision_note=None,
            created_at=datetime.now(UTC),
            slots=((day, role),),
        )
    )
