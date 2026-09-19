import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime
from typing import Protocol

from oncall.domain.ports import PublishedRoster, TeamDirectory
from oncall.domain.roster import Slot
from oncall.domain.scheduling.models import (
    ApprovedSwap,
    CarriedChange,
    ChangeRecord,
    CoveredSpan,
    GenerationRun,
    PendingSwap,
    PendingSwapNotice,
    PolicyChange,
    QueueBacklog,
    Schedule,
    ScheduleSummary,
    SchedulingPolicy,
)
from oncall.domain.scheduling.solver import (
    GeneratedAssignment,
    ProgressCallback,
    SolveProblem,
    SolverResult,
)
from oncall.domain.team import Member
from oncall.domain.vocabulary import AssignmentRole, RotationMode, ScheduleStatus
from oncall.fairness import FairnessDuty, FairnessMemberInput


class StoredSchedule(Protocol):
    """A schedule handed to storage; its id is known once the unit of work is
    written."""

    @property
    def id(self) -> uuid.UUID | None: ...


@dataclass(frozen=True)
class NewDraft:
    name: str
    starts_on: date
    ends_on: date
    rotation_mode: RotationMode
    result: SolverResult
    assignments: tuple[tuple[GeneratedAssignment, uuid.UUID | None], ...]


class Schedules(Protocol):
    """Schedules with their assignments, whatever their status."""

    async def schedule(self, schedule_id: uuid.UUID) -> Schedule | None: ...

    async def schedules(self, schedule_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, Schedule]: ...

    async def schedule_to_correct(self, schedule_id: uuid.UUID) -> Schedule | None:
        """The schedule, held against concurrent corrections until the unit of
        work ends."""
        ...

    async def schedule_to_publish(self, schedule_id: uuid.UUID) -> Schedule | None:
        """The schedule, held against concurrent writers until the unit of work
        ends. Call `hold_publication` first."""
        ...

    async def hold_publication(self) -> None:
        """Serialise publication: two overlapping ranges must not be published
        at the same time."""
        ...

    async def open_drafts(self, limit: int) -> list[ScheduleSummary]:
        """Drafts and proposals, latest horizon first."""
        ...

    async def covering_spans(self, ending_on_or_after: date) -> list[CoveredSpan]:
        """Published schedules and imported history, by start then end."""
        ...

    async def published_overlapping(self, schedule: Schedule) -> dict[uuid.UUID, CoveredSpan]:
        """Other published schedules that share a day with this one."""
        ...

    async def store_draft(self, draft: NewDraft) -> StoredSchedule: ...

    async def correct(self, schedule_id: uuid.UUID, slot: Slot, to: Member) -> None:
        """Give a slot of a held schedule to someone and move its version."""
        ...

    async def change_status(
        self,
        schedule_id: uuid.UUID,
        *,
        from_status: ScheduleStatus,
        to_status: ScheduleStatus,
        expected_version: int,
    ) -> bool:
        """Atomic: of two callers expecting the same version, one wins."""
        ...

    async def delete(self, schedule_id: uuid.UUID) -> None: ...

    async def carry(self, schedule_id: uuid.UUID, changes: list[CarriedChange]) -> None: ...

    async def retire_covered_by(self, schedule: Schedule) -> None:
        """Supersede every other published schedule wholly inside this one's
        range."""
        ...

    async def mark_published(
        self, schedule_id: uuid.UUID, *, name: str, published_at: datetime
    ) -> None: ...


class GenerationQueue(Protocol):
    async def active_run_for(self, starts_on: date, ends_on: date) -> GenerationRun | None: ...

    async def enqueue(
        self, starts_on: date, ends_on: date, requested_by_id: uuid.UUID
    ) -> GenerationRun:
        """The run queued for the range: a new one, or the one a concurrent
        request queued first."""
        ...

    async def run(self, run_id: uuid.UUID) -> GenerationRun | None: ...

    async def runs_of(
        self, requested_by_id: uuid.UUID, statuses: list[str], limit: int
    ) -> list[GenerationRun]:
        """Newest first."""
        ...

    async def active_runs_before(self, created_at: datetime) -> int: ...

    async def recent_completed(self, limit: int) -> list[GenerationRun]:
        """Newest first."""
        ...

    async def backlog(self) -> QueueBacklog:
        """How many runs are waiting or held, and the two moments that say how
        long: the oldest wait and the oldest heartbeat. One read, whatever the
        queue's size - this is sampled on a timer for as long as the worker
        lives."""
        ...

    async def abandon_stale_runs(self, untouched_since: datetime, error: str) -> int:
        """Fail every `running` run whose row has not been touched since that
        moment; returns how many were reclaimed.

        One conditional statement rather than read-then-write, so two workers
        doing this at once cannot both reclaim the same run.
        """
        ...


class PolicyStore(Protocol):
    async def current(self) -> SchedulingPolicy:
        """The one policy, created with defaults on first use."""
        ...

    async def change(self, change: PolicyChange) -> SchedulingPolicy:
        """Stage the change and answer with the policy as it now stands."""
        ...


class ChangeLog(Protocol):
    """What happened since a draft was generated, and who a manual change
    replaced."""

    async def changes_since(
        self, moment: datetime, actions: Iterable[str]
    ) -> list[ChangeRecord]: ...

    async def schedule_changes(
        self, schedule_ids: Iterable[uuid.UUID], actions: Iterable[str]
    ) -> list[ChangeRecord]:
        """Oldest first."""
        ...

    async def availability_spans(
        self, entry_ids: Iterable[uuid.UUID]
    ) -> dict[uuid.UUID, tuple[date, date]]: ...

    async def eligibility_spans(
        self, period_ids: Iterable[uuid.UUID]
    ) -> dict[uuid.UUID, tuple[date, date | None]]: ...

    async def swap_slot_days(
        self, swap_ids: Iterable[uuid.UUID]
    ) -> dict[uuid.UUID, list[date]]: ...


class PublicationSwaps(Protocol):
    async def approved_on(self, schedule_ids: Iterable[uuid.UUID]) -> list[ApprovedSwap]: ...

    async def pending_on(self, schedule_ids: Iterable[uuid.UUID]) -> list[PendingSwap]: ...

    async def cancel_for_publication(self, swap_ids: Iterable[uuid.UUID]) -> list[uuid.UUID]:
        """Cancel these swaps; answers with the ones cancelled, in the order
        they were taken."""
        ...


class SchedulingTeam(Protocol):
    async def everyone(self) -> list[Member]:
        """Every rotation member, in the store's own order."""
        ...

    async def active_between(self, starts_on: date, ends_on: date) -> list[FairnessMemberInput]:
        """Members active at some point of the window, by display name."""
        ...

    async def ids_by_name(self, names: Iterable[str]) -> dict[str, uuid.UUID]: ...


class DutyHistory(Protocol):
    """Duty already served, as the generator and the fairness forecast read it."""

    async def points(
        self, window_start: date, window_end: date, names_by_id: dict[uuid.UUID, str]
    ) -> tuple[dict[tuple[str, AssignmentRole], float], dict[tuple[str, str], float]]:
        """Points per (name, role) and lens counts per (name, lens)."""
        ...

    async def prior_oncall_days(
        self, starts_on: date, names_by_id: dict[uuid.UUID, str]
    ) -> dict[str, set[date]]: ...

    async def duties_in_force(self, window_start: date, window_end: date) -> list[FairnessDuty]: ...


class Solver(Protocol):
    async def solve(
        self, problem: SolveProblem, progress: ProgressCallback | None
    ) -> SolverResult: ...


class SchedulingJournal(Protocol):
    """Audit entries and notifications, in the name of the coordinator acting."""

    async def policy_updated(self, policy: SchedulingPolicy) -> None: ...

    async def draft_generated(self, stored: StoredSchedule, draft: NewDraft) -> None: ...

    async def draft_corrected(
        self, schedule_id: uuid.UUID, slot: Slot, previous_name: str, new_name: str
    ) -> None: ...

    async def schedule_deleted(self, schedule: Schedule, kind: str) -> None: ...

    async def schedule_proposed(self, schedule_id: uuid.UUID) -> None: ...

    async def proposal_withdrawn(self, schedule_id: uuid.UUID) -> None: ...

    async def change_carried(
        self,
        schedule_id: uuid.UUID,
        slot: Slot,
        *,
        original_name: str | None,
        carried_name: str,
        source: str,
    ) -> None: ...

    async def swap_cancelled_by_publication(
        self, notice: PendingSwapNotice, swap_id: uuid.UUID
    ) -> None: ...

    async def assignments_changed_by_publication(
        self, schedule_id: uuid.UUID, changes: list[tuple[date, AssignmentRole, str, str]]
    ) -> None: ...

    async def schedule_published(self, schedule: Schedule, name: str) -> None:
        """Tell the team, then record who published it."""
        ...


@dataclass(frozen=True)
class SchedulingPorts:
    schedules: Schedules
    roster: PublishedRoster
    team: TeamDirectory
    policy: PolicyStore
    changes: ChangeLog
    journal: SchedulingJournal
    swaps: PublicationSwaps
    queue: GenerationQueue
    members: SchedulingTeam
    history: DutyHistory
    solver: Solver
