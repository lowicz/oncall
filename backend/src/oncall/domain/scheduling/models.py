"""Schedules on their way to publication, and the generations that make them."""

import uuid
from dataclasses import dataclass, field, replace
from datetime import date, datetime
from enum import StrEnum
from typing import Literal

from oncall.domain.roster import Slot
from oncall.domain.team import Actor
from oncall.domain.vocabulary import (
    AssignmentRole,
    LateShiftAnchor,
    RotationMode,
    ScheduleStatus,
)
from oncall.fairness import MemberBalance
from oncall.rules import RuleViolation

#: How a rotation mode is named in a generated draft's name.
ROTATION_NAME_LABELS = {
    RotationMode.daily: "dzienny",
    RotationMode.hybrid: "hybrydowy",
    RotationMode.weekly: "tygodniowy",
}

#: Imported history is stored as superseded schedules under this name prefix.
HISTORY_IMPORT_PREFIX = "Import historii:"


class RunState(StrEnum):
    """The four states a generation run passes through.

    A `StrEnum` rather than a database enum: the column is plain text, and the
    client pins these four spellings, so this names what is already there
    instead of introducing a migration or a fifth state. Every transition
    between them happens in `oncall.worker`.
    """

    queued = "queued"
    """Somebody asked for this range. No lane has taken it."""

    running = "running"
    """A lane holds it. Only that lane may write the row, and only while its
    progress loop keeps `updated_at` fresh."""

    completed = "completed"
    """A draft exists; `schedule_id` points at it."""

    failed = "failed"
    """Nothing usable came out, and `error` says why to the coordinator. Also
    where a run lands when the lane holding it died."""


#: Generation runs still waiting for or holding a worker lane. What
#: `active_run_for` looks for, and therefore what blocks a second generation of
#: the same range.
ACTIVE_RUN_STATES = (RunState.queued, RunState.running)


class RunOutcome(StrEnum):
    """How a generation job ended, grouped the way an operator reads failures.

    `RunState` is what the coordinator polls; this is the finer question of
    why, and it exists because „failed" covers four different problems with
    four different answers. It is reported as a measurement and is not stored.
    """

    completed = "completed"
    """A draft came out of it."""

    infeasible = "infeasible"
    """The solver could not fill the horizon: the hard rules and the roster
    disagree. Nothing to fix in the worker; somebody must change the inputs."""

    requester_missing = "requester_missing"
    """The account that asked for the range was deleted while it waited."""

    error = "error"
    """Anything else the lane caught. A rising count here is a defect, not a
    scheduling problem."""

    reclaimed = "reclaimed"
    """The lane finished, but the run had already been declared abandoned and
    the terminal write was refused. The solve was done and thrown away, so a
    count above zero means `stale_run_seconds` is too tight for this roster."""


@dataclass(frozen=True)
class QueueBacklog:
    """The generation queue as one read of the rows: how many are waiting or
    held, and since when. Timestamps rather than ages, so the clock stays with
    the caller."""

    queued: int
    running: int
    oldest_queued_at: datetime | None
    stalest_running_at: datetime | None


@dataclass(frozen=True)
class QueueHealth:
    """The same backlog against a moment: what an operator watches.

    `oldest_queued_seconds` is how long the coordinator who has waited longest
    has been waiting. `stalest_running_seconds` is the oldest heartbeat among
    held runs, so it approaches `stale_run_seconds` exactly when recovery is
    about to step in.
    """

    queued: int
    running: int
    oldest_queued_seconds: float
    stalest_running_seconds: float


@dataclass(frozen=True)
class PlannedDuty:
    """One slot of a schedule as the schedule itself has it."""

    service_date: date
    role: AssignmentRole
    assignee_name: str
    member_id: uuid.UUID | None
    is_override: bool

    @property
    def slot(self) -> Slot:
        return (self.service_date, self.role)


@dataclass(frozen=True)
class Plan:
    """A schedule with its assignments, in any status.

    `assignments` keeps the order the store returned them in: the warnings
    built from it are listed in that order.
    """

    id: uuid.UUID
    name: str
    starts_on: date
    ends_on: date
    status: ScheduleStatus
    version: int
    created_at: datetime | None
    rotation_mode: RotationMode | None
    solver_status: str | None
    acceptance_floor: int | None
    fairness_proven: bool
    continuity_gap: float | None
    solver_warnings: tuple[str, ...]
    assignments: tuple[PlannedDuty, ...]

    @property
    def is_imported_history(self) -> bool:
        return self.status == ScheduleStatus.superseded and self.name.startswith(
            HISTORY_IMPORT_PREFIX
        )

    def with_holder(self, slot: Slot, name: str, member_id: uuid.UUID) -> Plan:
        """The plan with one slot handed to someone as a manual correction."""
        return replace(
            self,
            assignments=tuple(
                replace(item, assignee_name=name, member_id=member_id, is_override=True)
                if item.slot == slot
                else item
                for item in self.assignments
            ),
        )


@dataclass(frozen=True)
class PlanSummary:
    """A schedule without its assignments, for the drafts listing."""

    id: uuid.UUID
    name: str
    starts_on: date
    ends_on: date
    status: ScheduleStatus
    version: int
    rotation_mode: RotationMode | None
    solver_status: str | None
    assignment_count: int
    created_at: datetime | None


@dataclass(frozen=True)
class UnavailabilityConflict:
    """An assignment landing on a hard „nie mogę" of the person assigned."""

    service_date: date
    role: AssignmentRole
    assignee_name: str

    @property
    def message(self) -> str:
        return (
            f"{self.service_date.isoformat()} · {self.role.value}: "
            f"{self.assignee_name} ma twardą niedostępność"
        )


@dataclass(frozen=True)
class PlanView:
    """The schedule as the generator screen sees it.

    Hard-unavailability conflicts ride along with every view, so the draft
    matrix can show them before „Przekaż do akceptacji" is clicked instead of
    the coordinator learning about them from a 409. Solver warnings and rule
    warnings stay apart.
    """

    plan: Plan
    rule_warnings: tuple[str, ...]
    unavailability_conflicts: tuple[UnavailabilityConflict, ...]
    uncovered_before: tuple[date, ...]
    stale_changes_count: int


@dataclass(frozen=True)
class SchedulingPolicy:
    id: uuid.UUID
    rotation_mode: RotationMode
    fairness_weight: float
    continuity_weight: float
    preference_weight: float
    late_shift_anchor: LateShiftAnchor
    solve_seconds: float
    updated_at: datetime | None


@dataclass(frozen=True)
class PolicyChange:
    rotation_mode: RotationMode
    fairness_weight: float | None = None
    continuity_weight: float | None = None
    preference_weight: float | None = None
    late_shift_anchor: LateShiftAnchor | None = None
    solve_seconds: float | None = None


@dataclass(frozen=True)
class GenerationRun:
    id: uuid.UUID
    starts_on: date
    ends_on: date
    requested_by_id: uuid.UUID | None
    status: str
    progress: int
    schedule_id: uuid.UUID | None
    error: str | None
    conflicts: tuple[str, ...] | None
    created_at: datetime
    updated_at: datetime | None


@dataclass(frozen=True)
class RunView:
    """A generation with where it stands in the queue.

    Position is never stored - storing it would mean every dequeue rewrites
    every other row. Both queue numbers are None once the run is no longer
    queued (position 0 while it runs).
    """

    run: GenerationRun
    solve_seconds: float
    queue_position: int | None
    estimated_start_seconds: int | None


@dataclass(frozen=True)
class QueuedGeneration:
    view: RunView
    uncovered_before: tuple[date, ...]


@dataclass(frozen=True)
class GenerationRequest:
    actor: Actor
    starts_on: date
    ends_on: date


@dataclass(frozen=True)
class SuggestedRange:
    first_uncovered: date
    starts_on: date
    ends_on: date


@dataclass(frozen=True)
class CoveredSpan:
    """The dates a published schedule (or imported history) covers."""

    starts_on: date
    ends_on: date


@dataclass(frozen=True)
class VariantMetrics:
    id: uuid.UUID
    name: str
    rotation_mode: RotationMode | None
    assignment_count: int
    handovers: int
    max_consecutive_days: int
    load_spread: int
    override_count: int


@dataclass(frozen=True)
class Comparison:
    starts_on: date
    ends_on: date
    variants: tuple[VariantMetrics, VariantMetrics]


@dataclass(frozen=True)
class LensImpact:
    lens: str
    before: float
    after: float
    meets_criterion: bool


@dataclass(frozen=True)
class FairnessImpact:
    plan: Plan
    as_of: date
    baseline: tuple[MemberBalance, ...]
    projected: tuple[MemberBalance, ...]
    criterion_ids: frozenset[uuid.UUID]
    late_shift_balanced: bool
    criterion_points: int
    spreads: tuple[LensImpact, ...]

    @property
    def criterion_met(self) -> bool:
        return all(item.meets_criterion for item in self.spreads)


@dataclass(frozen=True)
class DraftCorrection:
    actor: Actor
    schedule_id: uuid.UUID
    expected_version: int
    service_date: date
    role: AssignmentRole
    replacement_member_id: uuid.UUID


@dataclass(frozen=True)
class Transition:
    actor: Actor
    schedule_id: uuid.UUID
    expected_version: int


ChangeResolution = Literal["draft", "change"]


@dataclass(frozen=True)
class PublicationRequest:
    actor: Actor
    schedule_id: uuid.UUID
    expected_version: int
    acknowledge_lost_changes: bool = False
    acknowledge_gap: bool = False
    acknowledge_rest_violations: bool = False
    #: Keyed "YYYY-MM-DD:role", as the preview lists the slots.
    change_resolutions: dict[str, ChangeResolution] = field(default_factory=dict)


def slot_key(service_date: date, role: AssignmentRole) -> str:
    return f"{service_date.isoformat()}:{role.value}"


@dataclass(frozen=True)
class ProtectedChange:
    """A manual change in force that publication would replace.

    `previous_assignee_name` holds the slot now; `original_assignee_name` is
    who they replaced, when that can be told. A change without a `reason` is
    carried into the new schedule; one with a reason is lost unless the
    coordinator resolves it.
    """

    service_date: date
    role: AssignmentRole
    previous_assignee_name: str
    new_assignee_name: str
    source: str
    original_assignee_name: str | None = None
    reason: str | None = None

    @property
    def slot(self) -> Slot:
        return (self.service_date, self.role)

    @property
    def key(self) -> str:
        return slot_key(self.service_date, self.role)


@dataclass(frozen=True)
class PendingSwapNotice:
    """A swap still in progress on a schedule publication will replace."""

    id: uuid.UUID
    service_date: date
    role: AssignmentRole
    requester_name: str
    replacement_name: str
    status: str


@dataclass(frozen=True)
class ReplacedDuty:
    """A slot publication gives to someone other than its holder in force."""

    schedule_id: uuid.UUID
    service_date: date
    role: AssignmentRole
    assignee_name: str
    member_id: uuid.UUID | None
    is_override: bool
    new_assignee_name: str

    @property
    def slot(self) -> Slot:
        return (self.service_date, self.role)


@dataclass(frozen=True)
class PublicationPreview:
    lost_changes: tuple[ProtectedChange, ...]
    carried_changes: tuple[ProtectedChange, ...]
    pending_swaps: tuple[PendingSwapNotice, ...]
    uncovered_before: tuple[date, ...]
    stale_changes_count: int
    rest_violations: tuple[RuleViolation, ...]
    #: Every slot whose holder changes, in the order the roster listed them.
    replaced: tuple[ReplacedDuty, ...] = ()


@dataclass(frozen=True)
class ChangeRecord:
    """One audit entry, as the stale-draft and republish checks read it."""

    action: str
    entity_id: str | None
    summary: str
    details: dict | None


@dataclass(frozen=True)
class ApprovedSwap:
    schedule_id: uuid.UUID
    requester_name: str | None
    replacement_name: str | None
    #: Every slot the swap moved; a coupled 11-19 swap moves two.
    slots: tuple[Slot, ...]


@dataclass(frozen=True)
class PendingSwap:
    id: uuid.UUID
    schedule_id: uuid.UUID
    service_date: date
    role: AssignmentRole
    status: str
    requester_member_id: uuid.UUID
    replacement_member_id: uuid.UUID
    slot_dates: tuple[date, ...]


@dataclass(frozen=True)
class CarriedChange:
    """A protected change written back into the schedule being published."""

    slot: Slot
    assignee_name: str
    member_id: uuid.UUID | None
