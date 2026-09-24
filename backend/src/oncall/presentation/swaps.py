"""HTTP contracts and edge mappers for duty swaps."""

import uuid
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from oncall.domain.swaps.models import ReplacementOption, SwapPolicy, SwapRequestView
from oncall.domain.vocabulary import AssignmentRole, AvailabilityKind, SwapStatus
from oncall.presentation.reports import FairnessMemberResponse
from oncall.presentation.rules import RuleViolationResponse, rule_violation_responses


class SwapSlotResponse(BaseModel):
    service_date: date
    role: AssignmentRole


class SwapOptionResponse(BaseModel):
    """One candidate replacement, with what deciding between two of them needs.

    The impact preview only appears once a candidate is picked, so comparing
    two people any other way means selecting each in turn and remembering the
    numbers. These facts travel with the name instead. The current balance
    is not among them: `/swaps/impact` already carries it for every option and
    the screen fetches those anyway, so computing it again here only made this
    endpoint as slow as the whole fairness report.
    """

    member_id: uuid.UUID
    display_name: str
    availability: AvailabilityKind | None = None
    on_duty_that_day: bool = False
    slots: list[SwapSlotResponse] = []
    blocking_violations: list[RuleViolationResponse] = []
    warning_violations: list[RuleViolationResponse] = []
    next_step: str | None = None


class SwapRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schedule_id: uuid.UUID
    service_date: date
    role: AssignmentRole
    replacement_member_id: uuid.UUID
    note: str | None = Field(default=None, max_length=500)


class SwapDecisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1, max_length=500, pattern=r"\S")


class SwapRequestResponse(BaseModel):
    id: uuid.UUID
    schedule_id: uuid.UUID
    service_date: date
    role: AssignmentRole
    requester_name: str
    replacement_name: str
    requester_member_id: uuid.UUID
    replacement_member_id: uuid.UUID
    status: SwapStatus
    note: str | None
    decision_note: str | None
    created_at: datetime
    slots: list[SwapSlotResponse] = []
    warnings: list[RuleViolationResponse] = []


class SwapPolicyResponse(BaseModel):
    """How far a request travels once the replacement agrees."""

    #: True: the request then waits for a coordinator. False: the acceptance
    #: writes it into the schedule and coordinators are only told.
    coordinator_approval_required: bool


class SwapImpactMemberResponse(BaseModel):
    """One side of a swap: the balance now and after the duty moves."""

    member_id: uuid.UUID
    display_name: str
    before: FairnessMemberResponse
    after: FairnessMemberResponse


class SwapImpactResponse(BaseModel):
    """Projected effect of moving a single duty, shown before the request is sent."""

    service_date: date
    role: AssignmentRole
    points: float
    window_start: date
    window_end: date
    requester: SwapImpactMemberResponse
    replacement: SwapImpactMemberResponse
    warnings: list[RuleViolationResponse] = Field(default_factory=list)


def swap_response(view: SwapRequestView) -> SwapRequestResponse:
    request = view.request
    return SwapRequestResponse(
        id=request.id,
        schedule_id=request.schedule_id,
        service_date=request.service_date,
        role=request.role,
        requester_name=view.requester_name,
        replacement_name=view.replacement_name,
        requester_member_id=request.requester_member_id,
        replacement_member_id=request.replacement_member_id,
        status=request.status,
        note=request.note,
        decision_note=request.decision_note,
        created_at=request.created_at,
        slots=[SwapSlotResponse(service_date=day, role=role) for day, role in view.slots],
        warnings=rule_violation_responses(view.warnings),
    )


def swap_policy_response(policy: SwapPolicy) -> SwapPolicyResponse:
    return SwapPolicyResponse(coordinator_approval_required=policy.coordinator_approval_required)


def swap_option_response(option: ReplacementOption) -> SwapOptionResponse:
    return SwapOptionResponse(
        member_id=option.member.id,
        display_name=option.member.display_name,
        availability=option.availability,
        on_duty_that_day=option.on_duty_that_day,
        slots=[SwapSlotResponse(service_date=day, role=role) for day, role in option.slots],
        blocking_violations=rule_violation_responses(option.blocking_violations),
        warning_violations=rule_violation_responses(option.warning_violations),
        next_step=option.next_step,
    )


__all__ = [
    "SwapDecisionRequest",
    "SwapImpactMemberResponse",
    "SwapImpactResponse",
    "SwapOptionResponse",
    "SwapPolicyResponse",
    "SwapRequestCreate",
    "SwapRequestResponse",
    "SwapSlotResponse",
    "swap_option_response",
    "swap_policy_response",
    "swap_response",
]
