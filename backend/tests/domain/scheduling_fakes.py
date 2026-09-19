"""In-memory ports for the scheduling use cases."""

import uuid
from dataclasses import dataclass, field, replace
from datetime import UTC, date, datetime, timedelta

from oncall.domain.roster import Duty
from oncall.domain.scheduling.models import (
    ApprovedSwap,
    ChangeRecord,
    CoveredSpan,
    GenerationRun,
    PendingSwap,
    Schedule,
    ScheduledDuty,
    ScheduleSummary,
    SchedulingPolicy,
)
from oncall.domain.scheduling.ports import SchedulingPorts
from oncall.domain.scheduling.solver import SolverResult
from oncall.domain.team import Member
from oncall.domain.vocabulary import (
    AssignmentRole,
    LateShiftAnchor,
    RotationMode,
    ScheduleStatus,
)
from oncall.workdays import is_working_day, polish_holidays
from tests.domain.fakes import FakeJournal, FakeRoster, FakeTeam


def complete_schedule(
    starts_on: date,
    rotation: list[Member],
    *,
    days: int = 14,
    status: ScheduleStatus = ScheduleStatus.draft,
    name: str = "Szkic testowy",
    version: int = 1,
) -> Schedule:
    """A schedule covering every slot: rotation[i] on primary, the next person on
    secondary and on 11-19 on working days."""
    ends_on = starts_on + timedelta(days=days - 1)
    holidays = polish_holidays(starts_on, ends_on)
    assignments = []
    for offset in range(days):
        day = starts_on + timedelta(days=offset)
        holders = {
            AssignmentRole.primary: rotation[offset % len(rotation)],
            AssignmentRole.secondary: rotation[(offset + 1) % len(rotation)],
        }
        if is_working_day(day, holidays):
            holders[AssignmentRole.late_shift] = holders[AssignmentRole.secondary]
        assignments += [
            ScheduledDuty(day, role, holder.display_name, holder.id, False)
            for role, holder in holders.items()
        ]
    return Schedule(
        id=uuid.uuid4(),
        name=name,
        starts_on=starts_on,
        ends_on=ends_on,
        status=status,
        version=version,
        created_at=datetime(2030, 1, 1, tzinfo=UTC),
        rotation_mode=RotationMode.hybrid,
        solver_status="OPTIMAL",
        acceptance_floor=None,
        fairness_proven=True,
        continuity_gap=0.0,
        solver_warnings=(),
        assignments=tuple(assignments),
    )


class FakeSchedules:
    def __init__(self) -> None:
        self.by_id: dict[uuid.UUID, Schedule] = {}
        self.published_spans: dict[uuid.UUID, CoveredSpan] = {}
        self.stored: list = []
        self.deleted: list[uuid.UUID] = []
        self.carried: list = []
        self.retired_by: list[uuid.UUID] = []
        self.published: list[tuple[uuid.UUID, str, datetime]] = []
        self.held_publication = False

    def put(self, schedule: Schedule) -> Schedule:
        self.by_id[schedule.id] = schedule
        return schedule

    async def schedule(self, schedule_id):
        return self.by_id.get(schedule_id)

    async def schedules(self, schedule_ids):
        return {item: self.by_id[item] for item in schedule_ids if item in self.by_id}

    async def schedule_to_correct(self, schedule_id):
        return self.by_id.get(schedule_id)

    async def schedule_to_publish(self, schedule_id):
        assert self.held_publication, "publication must be serialised before the read"
        return self.by_id.get(schedule_id)

    async def hold_publication(self):
        self.held_publication = True

    async def open_drafts(self, limit):
        return [
            ScheduleSummary(
                item.id,
                item.name,
                item.starts_on,
                item.ends_on,
                item.status,
                item.version,
                item.rotation_mode,
                item.solver_status,
                len(item.assignments),
                item.created_at,
            )
            for item in self.by_id.values()
            if item.status in (ScheduleStatus.draft, ScheduleStatus.proposed)
        ][:limit]

    async def covering_spans(self, ending_on_or_after):
        return [
            item for item in self.published_spans.values() if item.ends_on >= ending_on_or_after
        ]

    async def published_overlapping(self, schedule):
        return {
            key: span
            for key, span in self.published_spans.items()
            if key != schedule.id
            and span.starts_on <= schedule.ends_on
            and span.ends_on >= schedule.starts_on
        }

    async def store_draft(self, draft):
        stored = type("Stored", (), {"id": None})()
        self.stored.append((stored, draft))
        return stored

    async def correct(self, schedule_id, slot, to):
        schedule = self.by_id[schedule_id]
        self.by_id[schedule_id] = replace(
            schedule.with_holder(slot, to.display_name, to.id), version=schedule.version + 1
        )

    async def change_status(self, schedule_id, *, from_status, to_status, expected_version):
        schedule = self.by_id.get(schedule_id)
        if (
            schedule is None
            or schedule.status != from_status
            or schedule.version != expected_version
        ):
            return False
        self.by_id[schedule_id] = replace(schedule, status=to_status, version=schedule.version + 1)
        return True

    async def delete(self, schedule_id):
        self.by_id.pop(schedule_id)
        self.deleted.append(schedule_id)

    async def carry(self, schedule_id, changes):
        self.carried.extend(changes)

    async def retire_covered_by(self, schedule):
        self.retired_by.append(schedule.id)

    async def mark_published(self, schedule_id, *, name, published_at):
        self.published.append((schedule_id, name, published_at))


class FakeQueue:
    def __init__(self) -> None:
        self.runs: dict[uuid.UUID, GenerationRun] = {}
        self.enqueued: list[GenerationRun] = []

    def put(self, run: GenerationRun) -> GenerationRun:
        self.runs[run.id] = run
        return run

    async def active_run_for(self, starts_on, ends_on):
        return next(
            (
                item
                for item in sorted(self.runs.values(), key=lambda run: run.created_at)
                if (item.starts_on, item.ends_on) == (starts_on, ends_on)
                and item.status in ("queued", "running")
            ),
            None,
        )

    async def enqueue(self, starts_on, ends_on, requested_by_id):
        run = self.put(queued_run(starts_on, ends_on, requested_by_id=requested_by_id))
        self.enqueued.append(run)
        return run

    async def run(self, run_id):
        return self.runs.get(run_id)

    async def runs_of(self, requested_by_id, statuses, limit):
        return [
            item
            for item in sorted(self.runs.values(), key=lambda run: run.created_at, reverse=True)
            if item.requested_by_id == requested_by_id and item.status in statuses
        ][:limit]

    async def active_runs_before(self, created_at):
        return sum(
            1
            for item in self.runs.values()
            if item.status in ("queued", "running") and item.created_at < created_at
        )

    async def recent_completed(self, limit):
        return [
            item
            for item in sorted(self.runs.values(), key=lambda run: run.created_at, reverse=True)
            if item.status == "completed"
        ][:limit]


_clock = [datetime(2030, 1, 1, tzinfo=UTC)]


def queued_run(
    starts_on: date,
    ends_on: date,
    *,
    status: str = "queued",
    requested_by_id: uuid.UUID | None = None,
    took: timedelta | None = None,
) -> GenerationRun:
    _clock[0] += timedelta(seconds=1)
    return GenerationRun(
        id=uuid.uuid4(),
        starts_on=starts_on,
        ends_on=ends_on,
        requested_by_id=requested_by_id,
        status=status,
        progress=0,
        schedule_id=None,
        error=None,
        conflicts=None,
        created_at=_clock[0],
        updated_at=_clock[0] + took if took is not None else _clock[0],
    )


class FakePolicyStore:
    def __init__(self, **values) -> None:
        self.policy = SchedulingPolicy(
            id=uuid.uuid4(),
            rotation_mode=RotationMode.hybrid,
            fairness_weight=3.0,
            continuity_weight=1.0,
            preference_weight=2.0,
            late_shift_anchor=LateShiftAnchor.secondary,
            solve_seconds=15.0,
            updated_at=None,
        )
        self.policy = replace(self.policy, **values)

    async def current(self):
        return self.policy

    async def change(self, change):
        updates = {"rotation_mode": change.rotation_mode}
        for name in (
            "fairness_weight",
            "continuity_weight",
            "preference_weight",
            "late_shift_anchor",
            "solve_seconds",
        ):
            if getattr(change, name) is not None:
                updates[name] = getattr(change, name)
        self.policy = replace(self.policy, **updates)
        return self.policy


@dataclass
class FakeChangeLog:
    records: list[tuple[datetime, ChangeRecord]] = field(default_factory=list)
    availability: dict = field(default_factory=dict)
    eligibility: dict = field(default_factory=dict)
    swap_days: dict = field(default_factory=dict)

    def add(self, action, *, entity_id=None, summary="", details=None, at=None) -> None:
        moment = at or datetime(2030, 6, 1, tzinfo=UTC)
        self.records.append(
            (moment, ChangeRecord(action, str(entity_id) if entity_id else None, summary, details))
        )

    async def changes_since(self, moment, actions):
        return [item for at, item in self.records if at > moment and item.action in actions]

    async def schedule_changes(self, schedule_ids, actions):
        ids = {str(item) for item in schedule_ids}
        return [
            item
            for _at, item in sorted(self.records, key=lambda pair: pair[0])
            if item.entity_id in ids and item.action in actions
        ]

    async def availability_spans(self, entry_ids):
        return {item: self.availability[item] for item in entry_ids if item in self.availability}

    async def eligibility_spans(self, period_ids):
        return {item: self.eligibility[item] for item in period_ids if item in self.eligibility}

    async def swap_slot_days(self, swap_ids):
        return {item: self.swap_days[item] for item in swap_ids if item in self.swap_days}


class FakePublicationSwaps:
    def __init__(self) -> None:
        self.approved: list[ApprovedSwap] = []
        self.pending: list[PendingSwap] = []
        self.cancelled: list[uuid.UUID] = []

    async def approved_on(self, schedule_ids):
        return [item for item in self.approved if item.schedule_id in schedule_ids]

    async def pending_on(self, schedule_ids):
        return [item for item in self.pending if item.schedule_id in schedule_ids]

    async def cancel_for_publication(self, swap_ids):
        taken = [item.id for item in self.pending if item.id in swap_ids]
        self.cancelled.extend(taken)
        return taken


class FakeSchedulingTeam:
    def __init__(self, team: FakeTeam) -> None:
        self.team = team

    async def everyone(self):
        return list(self.team.by_id.values())

    async def active_between(self, starts_on, ends_on):
        return []

    async def ids_by_name(self, names):
        return {
            item.display_name: item.id
            for item in self.team.by_id.values()
            if item.display_name in names
        }


class FakeHistory:
    async def points(self, window_start, window_end, names_by_id):
        return {}, {}

    async def prior_oncall_days(self, starts_on, names_by_id):
        return {}

    async def duties_in_force(self, window_start, window_end):
        return []


class FakeSolver:
    def __init__(self, result: SolverResult | None = None) -> None:
        self.result = result
        self.problems = []

    async def solve(self, problem, progress):
        self.problems.append(problem)
        assert self.result is not None
        return self.result


@dataclass
class SchedulingWorld:
    team: FakeTeam = field(default_factory=FakeTeam)
    roster: FakeRoster = field(default_factory=FakeRoster)
    schedules: FakeSchedules = field(default_factory=FakeSchedules)
    policy: FakePolicyStore = field(default_factory=FakePolicyStore)
    changes: FakeChangeLog = field(default_factory=FakeChangeLog)
    journal: FakeJournal = field(default_factory=FakeJournal)
    swaps: FakePublicationSwaps = field(default_factory=FakePublicationSwaps)
    queue: FakeQueue = field(default_factory=FakeQueue)
    history: FakeHistory = field(default_factory=FakeHistory)
    solver: FakeSolver = field(default_factory=FakeSolver)

    @property
    def ports(self) -> SchedulingPorts:
        return SchedulingPorts(
            schedules=self.schedules,
            roster=self.roster,
            team=self.team,
            policy=self.policy,
            changes=self.changes,
            journal=self.journal,
            swaps=self.swaps,
            queue=self.queue,
            members=FakeSchedulingTeam(self.team),
            history=self.history,
            solver=self.solver,
        )

    def publish_roster_from(self, schedule: Schedule) -> None:
        """Make the schedule's assignments the roster in force."""
        for item in schedule.assignments:
            self.roster.schedule_ref.slots[item.slot] = Duty(
                item.service_date,
                item.role,
                item.member_id,
                item.assignee_name,
                False,
                self.roster.schedule_ref.id,
            )
        self.schedules.published_spans[self.roster.schedule_ref.id] = CoveredSpan(
            schedule.starts_on, schedule.ends_on
        )
