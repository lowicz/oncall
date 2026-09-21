import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from oncall.auth import CsrfGuard
from oncall.bootstrap.providers import SchedulingReader, SchedulingWriter
from oncall.config import get_settings
from oncall.domain.clock import business_today, utc_now
from oncall.domain.scheduling import drafts, errors, generation, policy, publication
from oncall.domain.scheduling.models import (
    DraftCorrection,
    GenerationRequest,
    PolicyChange,
    PublicationRequest,
    Transition,
)
from oncall.domain.scheduling.ports import SchedulingPorts
from oncall.domain.vocabulary import UserRole
from oncall.fairness_data import member_response
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.permissions import require_roles
from oncall.presentation.reports import DraftFairnessImpactResponse, DraftLensSpreadResponse
from oncall.presentation.scheduling import (
    ComparisonResponse,
    DraftOverrideRequest,
    DraftScheduleResponse,
    GenerateScheduleRequest,
    PublishPreviewResponse,
    QueuedRunResponse,
    RunResponse,
    ScheduleSummaryResponse,
    ScheduleTransitionRequest,
    SchedulingPolicyResponse,
    SchedulingPolicyUpdate,
    SuggestedRangeResponse,
    comparison_response,
    pending_swap_response,
    protected_change_response,
    publication_preview_response,
    queued_run_response,
    run_response,
    schedule_response,
    schedule_summary_response,
    suggested_range_response,
    violation_response,
)
from oncall.routes.domain_edge import actor_from, domain_errors_as_http

router = APIRouter(prefix="/api/v1/scheduling", tags=["scheduling"])
Coordinator = Annotated[User, Depends(require_roles(UserRole.coordinator, UserRole.admin))]


def _utc_today() -> date:
    """Compatibility name; scheduling dates follow the business clock."""
    return business_today()


def _lanes() -> int:
    return get_settings().generation_concurrency


def _decision_detail(error: errors.PublicationNeedsDecision, **extra: object) -> dict:
    return {"message": str(error), "reason": error.reason, **extra}


SCHEDULING_ERROR_STATUSES = {
    errors.ScheduleNotFound: status.HTTP_404_NOT_FOUND,
    errors.GenerationRunNotFound: status.HTTP_404_NOT_FOUND,
    errors.EditableDraftNotFound: status.HTTP_404_NOT_FOUND,
    errors.ReplacementNotFound: status.HTTP_404_NOT_FOUND,
    errors.DraftSlotNotFound: status.HTTP_404_NOT_FOUND,
    errors.VariantNotFound: status.HTTP_404_NOT_FOUND,
    errors.PolicyWithoutWeight: status.HTTP_422_UNPROCESSABLE_CONTENT,
    errors.InvalidCorrection: status.HTTP_422_UNPROCESSABLE_CONTENT,
    errors.IncomparableVariants: status.HTTP_422_UNPROCESSABLE_CONTENT,
    errors.DraftChanged: status.HTTP_409_CONFLICT,
    errors.ScheduleConflict: status.HTTP_409_CONFLICT,
}
SCHEDULING_ERROR_DETAILS = {
    errors.UnavailablePeopleInSchedule: lambda error: {
        "message": error.message,
        "reason": error.reason,
        "conflicts": [item.message for item in error.conflicts],
    },
    errors.LostChangesNotAcknowledged: lambda error: _decision_detail(
        error,
        lost_changes=[
            protected_change_response(item).model_dump(mode="json") for item in error.lost_changes
        ],
        pending_swaps=[
            pending_swap_response(item).model_dump(mode="json") for item in error.pending_swaps
        ],
    ),
    errors.ChangeResolutionRequired: lambda error: _decision_detail(error, slots=error.slots),
    errors.GapNotAcknowledged: lambda error: _decision_detail(
        error, uncovered_before=[day.isoformat() for day in error.uncovered_before]
    ),
    errors.ChangeResolutionInvalid: lambda error: {
        "message": str(error),
        "reason": error.reason,
        "conflicts": [
            {"service_date": service_date.isoformat(), "role": role.value, "reason": reason}
            for (service_date, role), reason in sorted(error.conflicts.items())
        ],
    },
    errors.RestViolationsNotAcknowledged: lambda error: _decision_detail(
        error,
        rest_violations=[
            violation_response(item).model_dump(mode="json") for item in error.violations
        ],
    ),
}


def _scheduling_errors():
    return domain_errors_as_http(SCHEDULING_ERROR_STATUSES, SCHEDULING_ERROR_DETAILS)


async def _written_schedule(
    schedule_id: uuid.UUID, ports: SchedulingPorts, *, warnings: list[str] | None = None
) -> DraftScheduleResponse:
    """The schedule read back after its unit of work is written."""
    schedule = await ports.schedules.schedule(schedule_id)
    if schedule is None:
        with _scheduling_errors():
            raise errors.ScheduleNotFound(schedule_id)
    return schedule_response(
        await publication.view_schedule(schedule, ports, today=_utc_today(), warnings=warnings)
    )


@router.post("/runs", status_code=status.HTTP_202_ACCEPTED, response_model=dict)
async def queue_generation(
    payload: GenerateScheduleRequest,
    user: Coordinator,
    ports: SchedulingWriter,
    _: CsrfGuard,
) -> QueuedRunResponse:
    queued = await generation.queue_generation(
        GenerationRequest(actor_from(user), payload.starts_on, payload.ends_on),
        ports,
        lanes=_lanes(),
        today=_utc_today(),
    )
    return queued_run_response(queued)


@router.get("/runs", response_model=list[dict])
async def list_runs(
    user: Coordinator,
    ports: SchedulingReader,
    run_status: Annotated[str | None, Query(alias="status")] = None,
) -> list[RunResponse]:
    """This coordinator's generations that are still in flight.

    A screen that shows nothing invites the coordinator to start a second
    generation of the same range, which is why a reload must never lose a job
    the database still holds.
    """
    views = await generation.runs_in_flight(user.id, run_status, ports, lanes=_lanes())
    return [run_response(view) for view in views]


@router.get("/runs/{run_id}", response_model=dict)
async def generation_status(
    run_id: uuid.UUID, _: Coordinator, ports: SchedulingReader
) -> RunResponse:
    with _scheduling_errors():
        view = await generation.generation_status(run_id, ports, lanes=_lanes())
    return run_response(view)


@router.get("/suggested-range", response_model=dict[str, date])
async def suggested_range(_: Coordinator, ports: SchedulingReader) -> SuggestedRangeResponse:
    suggestion = await generation.suggest_range(ports, today=business_today())
    return suggested_range_response(suggestion)


@router.get("/policy", response_model=SchedulingPolicyResponse)
async def get_policy(_: Coordinator, ports: SchedulingReader) -> SchedulingPolicyResponse:
    return SchedulingPolicyResponse.model_validate(await policy.current_policy(ports))


@router.put("/policy", response_model=SchedulingPolicyResponse)
async def update_policy(
    payload: SchedulingPolicyUpdate,
    _: Coordinator,
    ports: SchedulingWriter,
    __: CsrfGuard,
) -> SchedulingPolicyResponse:
    with _scheduling_errors():
        changed_policy = await policy.change_policy(
            PolicyChange(
                rotation_mode=payload.rotation_mode,
                fairness_weight=payload.fairness_weight,
                continuity_weight=payload.continuity_weight,
                preference_weight=payload.preference_weight,
                late_shift_anchor=payload.late_shift_anchor,
                solve_seconds=payload.solve_seconds,
            ),
            ports,
        )
    return SchedulingPolicyResponse.model_validate(changed_policy)


@router.post("/{schedule_id}/override", response_model=DraftScheduleResponse)
async def override_draft_assignment(
    schedule_id: uuid.UUID,
    payload: DraftOverrideRequest,
    user: Coordinator,
    ports: SchedulingWriter,
    __: CsrfGuard,
) -> DraftScheduleResponse:
    with _scheduling_errors():
        warnings = await drafts.correct_draft(
            DraftCorrection(
                actor=actor_from(user),
                schedule_id=schedule_id,
                expected_version=payload.expected_version,
                service_date=payload.service_date,
                role=payload.role,
                replacement_member_id=payload.replacement_member_id,
            ),
            ports,
        )
    return await _written_schedule(schedule_id, ports, warnings=warnings)


@router.get("/drafts", response_model=list[ScheduleSummaryResponse])
async def list_drafts(
    _: Coordinator,
    ports: SchedulingReader,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
) -> list[ScheduleSummaryResponse]:
    """Drafts and proposals still awaiting a decision.

    Without this the generator result lived only in component state: reloading
    the page orphaned the draft in the database with no way back to it.
    """
    return [schedule_summary_response(item) for item in await drafts.open_drafts(limit, ports)]


@router.get("/compare", response_model=dict)
async def compare_schedules(
    left_id: Annotated[uuid.UUID, Query()],
    right_id: Annotated[uuid.UUID, Query()],
    _: Coordinator,
    ports: SchedulingReader,
) -> ComparisonResponse:
    with _scheduling_errors():
        comparison = await drafts.compare_variants(left_id, right_id, ports)
    return comparison_response(comparison)


@router.get("/{schedule_id}", response_model=DraftScheduleResponse)
async def get_schedule(
    schedule_id: uuid.UUID, _: Coordinator, ports: SchedulingReader
) -> DraftScheduleResponse:
    """One schedule with its assignments, so a draft survives a page reload."""
    with _scheduling_errors():
        view = await publication.show_schedule(schedule_id, ports, today=_utc_today())
    return schedule_response(view)


@router.get("/{schedule_id}/fairness-impact", response_model=DraftFairnessImpactResponse)
async def draft_fairness_impact(
    schedule_id: uuid.UUID,
    _: Coordinator,
    ports: SchedulingReader,
) -> DraftFairnessImpactResponse:
    with _scheduling_errors():
        impact = await drafts.fairness_impact(schedule_id, ports)
    criterion_ids = set(impact.criterion_ids)
    return DraftFairnessImpactResponse(
        schedule_id=impact.schedule.id,
        schedule_version=impact.schedule.version,
        baseline_as_of=impact.as_of,
        projected_as_of=impact.as_of,
        baseline_members=[member_response(item, criterion_ids) for item in impact.baseline],
        projected_members=[member_response(item, criterion_ids) for item in impact.projected],
        late_shift_balanced=impact.late_shift_balanced,
        criterion_points=impact.criterion_points,
        criterion_met=impact.criterion_met,
        spreads=[
            DraftLensSpreadResponse(
                lens=item.lens,
                before=item.before,
                after=item.after,
                meets_criterion=item.meets_criterion,
            )
            for item in impact.spreads
        ],
        acceptance_floor=impact.schedule.acceptance_floor,
    )


@router.delete("/{schedule_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_schedule(
    schedule_id: uuid.UUID, _: Coordinator, ports: SchedulingWriter, __: CsrfGuard
) -> None:
    """Discard a draft or a proposal.

    Published and superseded schedules are the record of who was on duty, so
    they are never deletable; abandoned drafts otherwise pile up in the listing.
    """
    with _scheduling_errors():
        await drafts.delete_schedule(schedule_id, ports)


@router.post("/{schedule_id}/propose", response_model=DraftScheduleResponse)
async def propose_schedule(
    schedule_id: uuid.UUID,
    payload: ScheduleTransitionRequest,
    user: Coordinator,
    ports: SchedulingWriter,
    __: CsrfGuard,
) -> DraftScheduleResponse:
    with _scheduling_errors():
        await drafts.propose(
            Transition(actor_from(user), schedule_id, payload.expected_version), ports
        )
    return await _written_schedule(schedule_id, ports)


@router.post("/{schedule_id}/withdraw", response_model=DraftScheduleResponse)
async def withdraw_schedule(
    schedule_id: uuid.UUID,
    payload: ScheduleTransitionRequest,
    user: Coordinator,
    ports: SchedulingWriter,
    __: CsrfGuard,
) -> DraftScheduleResponse:
    with _scheduling_errors():
        await drafts.withdraw(
            Transition(actor_from(user), schedule_id, payload.expected_version), ports
        )
    return await _written_schedule(schedule_id, ports)


@router.get("/{schedule_id}/publish-preview", response_model=PublishPreviewResponse)
async def publication_preview(
    schedule_id: uuid.UUID, _: Coordinator, ports: SchedulingReader
) -> PublishPreviewResponse:
    with _scheduling_errors():
        preview = await publication.preview_publication(schedule_id, ports, today=_utc_today())
    return publication_preview_response(preview)


@router.post("/{schedule_id}/publish", response_model=DraftScheduleResponse)
async def publish_schedule(
    schedule_id: uuid.UUID,
    payload: ScheduleTransitionRequest,
    user: Coordinator,
    ports: SchedulingWriter,
    __: CsrfGuard,
) -> DraftScheduleResponse:
    with _scheduling_errors():
        await publication.publish(
            PublicationRequest(
                actor=actor_from(user),
                schedule_id=schedule_id,
                expected_version=payload.expected_version,
                acknowledge_lost_changes=payload.acknowledge_lost_changes,
                acknowledge_gap=payload.acknowledge_gap,
                acknowledge_rest_violations=payload.acknowledge_rest_violations,
                change_resolutions=dict(payload.change_resolutions),
            ),
            ports,
            today=_utc_today(),
            now=utc_now(),
        )
    return await _written_schedule(schedule_id, ports)
