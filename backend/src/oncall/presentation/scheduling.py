"""HTTP contracts for schedule generation, drafts, and publication."""

import uuid
from datetime import date, datetime
from typing import Literal, TypedDict

from pydantic import BaseModel, ConfigDict, Field, computed_field, model_validator

from oncall.domain.scheduling.models import (
    Comparison,
    PendingSwapNotice,
    ProtectedChange,
    PublicationPreview,
    QueuedGeneration,
    RunView,
    ScheduleSummary,
    ScheduleView,
    SuggestedRange,
)
from oncall.domain.scheduling.solver import total_time_budget
from oncall.domain.vocabulary import AssignmentRole, LateShiftAnchor, RotationMode
from oncall.presentation.assignments import AssignmentResponse
from oncall.presentation.rules import RuleViolationResponse
from oncall.rules import RuleViolation

#: Solver budget bounds. Below 5 s the model is barely built; above 300 s the
#: request outlives every proxy timeout in front of it.
MIN_SOLVE_SECONDS = 5
MAX_SOLVE_SECONDS = 300


class SchedulingPolicyResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    rotation_mode: RotationMode
    fairness_weight: float
    continuity_weight: float
    preference_weight: float
    late_shift_anchor: LateShiftAnchor
    #: Budget of one ``solver.solve`` call.
    solve_seconds: float
    updated_at: datetime

    # mypy cannot type a decorator stacked on @property; Pydantic needs this order.
    @computed_field  # type: ignore[prop-decorator]
    @property
    def time_budget_seconds(self) -> float:
        """Hard wall-clock ceiling for one whole generation: a generation runs
        several solver passes in sequence, so this is what the coordinator
        actually waits for."""
        return total_time_budget(self.solve_seconds)


class SchedulingPolicyUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    rotation_mode: RotationMode
    fairness_weight: float | None = Field(default=None, ge=0, le=100)
    continuity_weight: float | None = Field(default=None, ge=0, le=100)
    preference_weight: float | None = Field(default=None, ge=0, le=100)
    late_shift_anchor: LateShiftAnchor | None = None
    solve_seconds: float | None = Field(default=None, ge=MIN_SOLVE_SECONDS, le=MAX_SOLVE_SECONDS)


class GenerateScheduleRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    starts_on: date
    ends_on: date

    @model_validator(mode="after")
    def validate_range(self) -> GenerateScheduleRequest:
        duration = (self.ends_on - self.starts_on).days
        if duration < 0:
            raise ValueError("Data końcowa nie może poprzedzać początkowej")
        if duration > 34:
            raise ValueError("Jedno uruchomienie może obejmować maksymalnie 35 dni")
        return self


class ScheduleWarningResponse(BaseModel):
    """One warning about a schedule, with the source that produced it.

    Merging both sources into bare strings made the solver's own warnings
    indistinguishable from the coordinator's rule warnings, and the latter
    opened with the word „Korekta" even where nobody had corrected anything.
    """

    #: „solver" - what CP-SAT had to give up; „rules" - a hard rule the
    #: schedule breaks as it stands.
    source: Literal["solver", "rules"]
    message: str


class UnavailabilityConflictResponse(BaseModel):
    """One assignment that lands on a hard „nie mogę" of the person assigned.

    Structured, not prerendered, because the draft matrix counts people and the
    409 detail renders sentences from the same list.
    """

    service_date: date
    role: AssignmentRole
    assignee_name: str


class DraftScheduleResponse(BaseModel):
    id: uuid.UUID
    name: str
    starts_on: date
    ends_on: date
    status: str
    version: int
    rotation_mode: RotationMode
    solver_status: str
    acceptance_floor: int | None = None
    fairness_proven: bool = False
    continuity_gap: float | None = None
    assignments: list[AssignmentResponse]
    warnings: list[ScheduleWarningResponse] = Field(default_factory=list)
    unavailability_conflicts: list[UnavailabilityConflictResponse] = Field(default_factory=list)
    uncovered_before: list[date] = Field(default_factory=list)
    stale_changes_count: int = 0


class ScheduleSummaryResponse(BaseModel):
    """A schedule without its assignments, for the drafts listing."""

    id: uuid.UUID
    name: str
    starts_on: date
    ends_on: date
    status: str
    version: int
    rotation_mode: RotationMode
    solver_status: str
    assignment_count: int
    created_at: datetime | None


class ScheduleTransitionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1)
    acknowledge_lost_changes: bool = False
    acknowledge_gap: bool = False
    acknowledge_rest_violations: bool = False
    change_resolutions: dict[str, Literal["draft", "change"]] = Field(default_factory=dict)


class PublishChangeResponse(BaseModel):
    service_date: date
    role: AssignmentRole
    previous_assignee_name: str
    new_assignee_name: str
    source: str
    original_assignee_name: str | None = None
    reason: str | None = None


class PublishPendingSwapResponse(BaseModel):
    id: uuid.UUID
    service_date: date
    role: AssignmentRole
    requester_name: str
    replacement_name: str
    status: str


class PublishPreviewResponse(BaseModel):
    lost_changes: list[PublishChangeResponse]
    carried_changes: list[PublishChangeResponse] = Field(default_factory=list)
    pending_swaps: list[PublishPendingSwapResponse]
    uncovered_before: list[date] = Field(default_factory=list)
    stale_changes_count: int = 0
    rest_violations: list[RuleViolationResponse] = Field(default_factory=list)


class DraftOverrideRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_version: int = Field(ge=1)
    service_date: date
    role: AssignmentRole
    replacement_member_id: uuid.UUID


class RunResponse(TypedDict):
    id: uuid.UUID
    status: str
    progress: int
    schedule_id: uuid.UUID | None
    error: str | None
    conflicts: list[str] | None
    created_at: datetime
    solve_seconds: float
    queue_position: int | None
    estimated_start_seconds: int | None


class QueuedRunResponse(RunResponse):
    uncovered_before: list[date]


class SuggestedRangeResponse(TypedDict):
    first_uncovered: date
    starts_on: date
    ends_on: date


class ComparisonVariantResponse(TypedDict):
    id: uuid.UUID
    name: str
    rotation_mode: RotationMode | None
    assignment_count: int
    handovers: int
    max_consecutive_days: int
    load_spread: int
    override_count: int


class ComparisonResponse(TypedDict):
    starts_on: date
    ends_on: date
    variants: list[ComparisonVariantResponse]


def run_response(view: RunView) -> RunResponse:
    run = view.run
    return {
        "id": run.id,
        "status": run.status,
        "progress": run.progress,
        "schedule_id": run.schedule_id,
        "error": run.error,
        "conflicts": list(run.conflicts) if run.conflicts is not None else None,
        "created_at": run.created_at,
        "solve_seconds": view.solve_seconds,
        "queue_position": view.queue_position,
        "estimated_start_seconds": view.estimated_start_seconds,
    }


def queued_run_response(queued: QueuedGeneration) -> QueuedRunResponse:
    return {
        **run_response(queued.view),
        "uncovered_before": list(queued.uncovered_before),
    }


def suggested_range_response(suggestion: SuggestedRange) -> SuggestedRangeResponse:
    return {
        "first_uncovered": suggestion.first_uncovered,
        "starts_on": suggestion.starts_on,
        "ends_on": suggestion.ends_on,
    }


def schedule_response(view: ScheduleView) -> DraftScheduleResponse:
    """The draft as the generator screen sees it."""
    schedule = view.schedule
    return DraftScheduleResponse(
        id=schedule.id,
        name=schedule.name,
        starts_on=schedule.starts_on,
        ends_on=schedule.ends_on,
        status=schedule.status.value,
        version=schedule.version,
        rotation_mode=schedule.rotation_mode or RotationMode.hybrid,
        solver_status=schedule.solver_status or "UNKNOWN",
        acceptance_floor=schedule.acceptance_floor,
        fairness_proven=schedule.fairness_proven,
        continuity_gap=schedule.continuity_gap,
        assignments=[
            AssignmentResponse(
                service_date=item.service_date,
                role=item.role,
                assignee_name=item.assignee_name,
                is_override=item.is_override,
            )
            for item in sorted(
                schedule.assignments,
                key=lambda assignment: (assignment.service_date, assignment.role.value),
            )
        ],
        warnings=[
            ScheduleWarningResponse(source="solver", message=message)
            for message in schedule.solver_warnings
        ]
        + [
            ScheduleWarningResponse(source="rules", message=message)
            for message in view.rule_warnings
        ],
        unavailability_conflicts=[
            UnavailabilityConflictResponse(
                service_date=item.service_date,
                role=item.role,
                assignee_name=item.assignee_name,
            )
            for item in view.unavailability_conflicts
        ],
        uncovered_before=list(view.uncovered_before),
        stale_changes_count=view.stale_changes_count,
    )


def schedule_summary_response(item: ScheduleSummary) -> ScheduleSummaryResponse:
    return ScheduleSummaryResponse(
        id=item.id,
        name=item.name,
        starts_on=item.starts_on,
        ends_on=item.ends_on,
        status=item.status.value,
        version=item.version,
        rotation_mode=item.rotation_mode or RotationMode.hybrid,
        solver_status=item.solver_status or "UNKNOWN",
        assignment_count=item.assignment_count,
        created_at=item.created_at,
    )


def comparison_response(comparison: Comparison) -> ComparisonResponse:
    return {
        "starts_on": comparison.starts_on,
        "ends_on": comparison.ends_on,
        "variants": [
            {
                "id": item.id,
                "name": item.name,
                "rotation_mode": item.rotation_mode,
                "assignment_count": item.assignment_count,
                "handovers": item.handovers,
                "max_consecutive_days": item.max_consecutive_days,
                "load_spread": item.load_spread,
                "override_count": item.override_count,
            }
            for item in comparison.variants
        ],
    }


def protected_change_response(change: ProtectedChange) -> PublishChangeResponse:
    return PublishChangeResponse(
        service_date=change.service_date,
        role=change.role,
        previous_assignee_name=change.previous_assignee_name,
        new_assignee_name=change.new_assignee_name,
        source=change.source,
        original_assignee_name=change.original_assignee_name,
        reason=change.reason,
    )


def pending_swap_response(item: PendingSwapNotice) -> PublishPendingSwapResponse:
    return PublishPendingSwapResponse(
        id=item.id,
        service_date=item.service_date,
        role=item.role,
        requester_name=item.requester_name,
        replacement_name=item.replacement_name,
        status=item.status,
    )


def violation_response(violation: RuleViolation) -> RuleViolationResponse:
    return RuleViolationResponse(
        rule=violation.rule,
        message=violation.message,
        member_name=violation.member_name,
        days=list(violation.days),
    )


def publication_preview_response(preview: PublicationPreview) -> PublishPreviewResponse:
    return PublishPreviewResponse(
        lost_changes=[protected_change_response(item) for item in preview.lost_changes],
        carried_changes=[protected_change_response(item) for item in preview.carried_changes],
        pending_swaps=[pending_swap_response(item) for item in preview.pending_swaps],
        uncovered_before=list(preview.uncovered_before),
        stale_changes_count=preview.stale_changes_count,
        rest_violations=[violation_response(item) for item in preview.rest_violations],
    )


__all__ = [
    "ComparisonResponse",
    "DraftOverrideRequest",
    "DraftScheduleResponse",
    "GenerateScheduleRequest",
    "MAX_SOLVE_SECONDS",
    "MIN_SOLVE_SECONDS",
    "PublishChangeResponse",
    "PublishPendingSwapResponse",
    "PublishPreviewResponse",
    "QueuedRunResponse",
    "RunResponse",
    "ScheduleSummaryResponse",
    "ScheduleTransitionRequest",
    "ScheduleWarningResponse",
    "SchedulingPolicyResponse",
    "SchedulingPolicyUpdate",
    "SuggestedRangeResponse",
    "UnavailabilityConflictResponse",
    "comparison_response",
    "pending_swap_response",
    "protected_change_response",
    "publication_preview_response",
    "queued_run_response",
    "run_response",
    "schedule_response",
    "schedule_summary_response",
    "suggested_range_response",
    "violation_response",
]
