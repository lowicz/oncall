import uuid
from datetime import date
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status

from oncall.auth import CsrfGuard, CurrentPrincipal
from oncall.bootstrap.providers import CalendarReader, CalendarWriter, OverrideProvider
from oncall.domain.calendar import errors as calendar_errors
from oncall.domain.calendar import use_cases as calendar_use_cases
from oncall.domain.calendar.models import CalendarEventChange, NewCalendarEvent
from oncall.domain.overrides import errors as override_errors
from oncall.domain.overrides import use_cases as override_use_cases
from oncall.domain.overrides.models import (
    BatchOverrideInput,
    BatchOverrideLine,
    OverrideCheck,
    OverrideInput,
)
from oncall.domain.vocabulary import UserRole
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.permissions import require_roles
from oncall.presentation.assignments import AssignmentResponse
from oncall.presentation.calendar import (
    CalendarEventCreate,
    CalendarEventResponse,
    CalendarEventUpdate,
    CalendarResponse,
    calendar_response,
)
from oncall.presentation.overrides import (
    BatchOverrideRequest,
    DirectOverrideCheckRequest,
    DirectOverrideRequest,
    override_assignment_response,
)
from oncall.presentation.rules import RuleViolationResponse, rule_violation_responses
from oncall.routes.domain_edge import (
    SHARED_ERROR_STATUSES,
    actor_from,
    audience_of,
    domain_errors_as_http,
)

router = APIRouter(prefix="/api/v1/calendar", tags=["calendar"])
Coordinator = Annotated[User, Depends(require_roles(UserRole.coordinator, UserRole.admin))]
WEEKDAYS = ("pon", "wt", "śr", "czw", "pt", "sob", "niedz")


CALENDAR_ERROR_STATUSES = {
    calendar_errors.CalendarRangeError: status.HTTP_422_UNPROCESSABLE_CONTENT,
    calendar_errors.CalendarEventNotFound: status.HTTP_404_NOT_FOUND,
}


def calendar_errors_as_http():
    return domain_errors_as_http(CALENDAR_ERROR_STATUSES)


@router.get("/events", response_model=list[CalendarEventResponse])
async def list_calendar_events(
    principal: CurrentPrincipal,
    ports: CalendarReader,
    starts_on: Annotated[date, Query()],
    ends_on: Annotated[date, Query()],
) -> list[CalendarEventResponse]:
    with calendar_errors_as_http():
        events = await calendar_use_cases.list_events(
            audience_of(principal), starts_on, ends_on, ports
        )
    return [CalendarEventResponse.model_validate(item) for item in events]


@router.post("/events", response_model=CalendarEventResponse, status_code=status.HTTP_201_CREATED)
async def create_calendar_event(
    payload: CalendarEventCreate, user: Coordinator, ports: CalendarWriter, _: CsrfGuard
) -> CalendarEventResponse:
    event = await calendar_use_cases.create_event(
        NewCalendarEvent(
            actor=actor_from(user),
            starts_on=payload.starts_on,
            ends_on=payload.ends_on,
            title=payload.title,
            color=payload.color,
        ),
        ports,
    )
    return CalendarEventResponse.model_validate(event)


@router.patch("/events/{event_id}", response_model=CalendarEventResponse)
async def update_calendar_event(
    event_id: uuid.UUID,
    payload: CalendarEventUpdate,
    user: Coordinator,
    ports: CalendarWriter,
    _: CsrfGuard,
) -> CalendarEventResponse:
    with calendar_errors_as_http():
        event = await calendar_use_cases.change_event(
            CalendarEventChange(
                actor=actor_from(user),
                event_id=event_id,
                changes=payload.model_dump(exclude_unset=True, exclude_none=True),
            ),
            ports,
        )
    return CalendarEventResponse.model_validate(event)


@router.delete("/events/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_calendar_event(
    event_id: uuid.UUID, _: Coordinator, ports: CalendarWriter, __: CsrfGuard
) -> None:
    with calendar_errors_as_http():
        await calendar_use_cases.delete_event(event_id, ports)


@router.get("", response_model=CalendarResponse)
async def calendar_matrix(
    principal: CurrentPrincipal,
    ports: CalendarReader,
    starts_on: Annotated[date, Query()],
    ends_on: Annotated[date, Query()],
) -> CalendarResponse:
    with calendar_errors_as_http():
        matrix = await calendar_use_cases.calendar_matrix(
            audience_of(principal), starts_on, ends_on, ports
        )
    return calendar_response(matrix)


OVERRIDE_ERROR_STATUSES = {
    **SHARED_ERROR_STATUSES,
    override_errors.LateShiftOnlyOnWorkingDays: status.HTTP_422_UNPROCESSABLE_CONTENT,
    override_errors.PublishedScheduleNotFound: status.HTTP_404_NOT_FOUND,
    override_errors.PersonNotFound: status.HTTP_404_NOT_FOUND,
    override_errors.PersonNotEligible: status.HTTP_422_UNPROCESSABLE_CONTENT,
    override_errors.PersonUnavailable: status.HTTP_422_UNPROCESSABLE_CONTENT,
    override_errors.PersonAlreadyHoldsRole: status.HTTP_422_UNPROCESSABLE_CONTENT,
    override_errors.PersonAlreadyOnCall: status.HTTP_422_UNPROCESSABLE_CONTENT,
    override_errors.RosterChangedMeanwhile: status.HTTP_409_CONFLICT,
    override_errors.RepeatedSlotInBatch: status.HTTP_422_UNPROCESSABLE_CONTENT,
    override_errors.EmptyBatch: status.HTTP_422_UNPROCESSABLE_CONTENT,
    override_errors.ScheduleSlotNotFound: status.HTTP_404_NOT_FOUND,
    override_errors.HistoricalCorrectionNeedsReason: status.HTTP_422_UNPROCESSABLE_CONTENT,
    override_errors.BatchCorrectionNeedsReason: status.HTTP_422_UNPROCESSABLE_CONTENT,
    override_errors.RuleViolationsNotAcknowledged: status.HTTP_409_CONFLICT,
}


def _unacknowledged_violations_detail(error: override_errors.RuleViolationsNotAcknowledged) -> dict:
    return {
        "message": str(error),
        "reason": error.reason,
        "next_step": error.next_step,
        "violations": [
            item.model_dump(mode="json") for item in rule_violation_responses(error.violations)
        ],
    }


OVERRIDE_ERROR_DETAILS = {
    override_errors.RuleViolationsNotAcknowledged: _unacknowledged_violations_detail
}


def _override_errors_as_http():
    return domain_errors_as_http(OVERRIDE_ERROR_STATUSES, OVERRIDE_ERROR_DETAILS)


@router.post("/override/check", response_model=list[RuleViolationResponse])
async def direct_override_check(
    payload: DirectOverrideCheckRequest,
    _: Coordinator,
    ports: OverrideProvider,
    __: CsrfGuard,
) -> list[RuleViolationResponse]:
    """The hard rules the override would break, computed before the fact so
    the confirmation dialog can show them and ask for their acknowledgement."""
    with _override_errors_as_http():
        violations = await override_use_cases.check_override(
            OverrideCheck(
                service_date=payload.service_date,
                role=payload.role,
                replacement_member_id=payload.replacement_member_id,
                schedule_id=payload.schedule_id,
            ),
            ports,
        )
    return rule_violation_responses(violations)


@router.post("/override", response_model=AssignmentResponse)
async def direct_override(
    payload: DirectOverrideRequest,
    user: Coordinator,
    ports: OverrideProvider,
    __: CsrfGuard,
) -> AssignmentResponse:
    with _override_errors_as_http():
        result = await override_use_cases.override_duty(
            OverrideInput(
                actor=actor_from(user),
                service_date=payload.service_date,
                role=payload.role,
                replacement_member_id=payload.replacement_member_id,
                expected_version=payload.expected_version,
                schedule_id=payload.schedule_id,
                reason=payload.reason,
                acknowledge_rule_violations=payload.acknowledge_rule_violations,
            ),
            ports,
        )
    return override_assignment_response(result)


@router.post("/override/batch", response_model=list[AssignmentResponse])
async def batch_override(
    payload: BatchOverrideRequest,
    user: Coordinator,
    ports: OverrideProvider,
    __: CsrfGuard,
) -> list[AssignmentResponse]:
    with _override_errors_as_http():
        results = await override_use_cases.override_duties_in_batch(
            BatchOverrideInput(
                actor=actor_from(user),
                schedule_id=payload.schedule_id,
                expected_version=payload.expected_version,
                lines=tuple(
                    BatchOverrideLine(item.service_date, item.role, item.replacement_member_id)
                    for item in payload.assignments
                ),
                reason=payload.reason,
                acknowledge_rule_violations=payload.acknowledge_rule_violations,
            ),
            ports,
        )
    return [override_assignment_response(result) for result in results]
