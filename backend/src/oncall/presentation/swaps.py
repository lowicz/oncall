"""HTTP contracts and edge mappers for duty swaps."""

import uuid
from collections.abc import Iterable
from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field

from oncall.domain.roster import Slot
from oncall.domain.swaps.models import ReplacementOption, ReturnOption, SwapRequestView
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
    #: Rules that rule the candidate out.
    blocking_violations: list[RuleViolationResponse] = []
    #: Hard rules a request to this candidate breaks; it has to acknowledge
    #: them and say why.
    rule_violations: list[RuleViolationResponse] = []
    warning_violations: list[RuleViolationResponse] = []
    next_step: str | None = None


class SwapReturnOptionResponse(BaseModel):
    """A duty of the replacement the requester could take in exchange. The
    three lists judge the whole exchange, both directions as one move."""

    service_date: date
    role: AssignmentRole
    slots: list[SwapSlotResponse] = []
    #: Rules that rule the exchange out.
    blocking_violations: list[RuleViolationResponse] = []
    #: Hard rules the exchange breaks; the request has to acknowledge them
    #: and say why.
    rule_violations: list[RuleViolationResponse] = []
    warning_violations: list[RuleViolationResponse] = []


class SwapReturnRequest(BaseModel):
    """The duty of the replacement the requester takes in exchange."""

    model_config = ConfigDict(extra="forbid")

    service_date: date
    role: AssignmentRole


class SwapRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schedule_id: uuid.UUID
    service_date: date
    role: AssignmentRole
    replacement_member_id: uuid.UUID
    note: str | None = Field(default=None, max_length=500)
    #: The requester has seen the hard rules the swap breaks; `note` then has
    #: to say why it is needed.
    acknowledge_rule_violations: bool = False
    #: Turns the hand-over into an exchange: both directions are checked as
    #: one move and decided by one acceptance and one approval.
    in_return: SwapReturnRequest | None = None


class SwapDecisionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str = Field(min_length=1, max_length=500, pattern=r"\S")


class SwapAcknowledgementRequest(BaseModel):
    """The optional body of an acceptance or an approval."""

    model_config = ConfigDict(extra="forbid")

    #: The person deciding has seen the hard rules the swap breaks on the
    #: roster as it is now.
    acknowledge_rule_violations: bool = False


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
    #: What the requester gives, the on-call role before its 11-19.
    slots: list[SwapSlotResponse] = []
    #: What the requester takes in exchange, in the same order; empty for a
    #: one-way hand-over.
    return_slots: list[SwapSlotResponse] = []
    #: Rules the swap bends: when it is created and while it is open.
    warnings: list[RuleViolationResponse] = []
    #: Hard rules the swap breaks: on the roster as it is now while the
    #: request is open, as last acknowledged once it is decided.
    rule_violations: list[RuleViolationResponse] = []


class SwapPolicyResponse(BaseModel):
    """How far a request travels once the replacement agrees."""

    model_config = ConfigDict(from_attributes=True)

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
    """Projected effect of a swap on both balances, shown before the request
    is sent: every slot it moves, in both directions of an exchange."""

    service_date: date
    role: AssignmentRole
    points: float
    window_start: date
    window_end: date
    requester: SwapImpactMemberResponse
    replacement: SwapImpactMemberResponse
    #: The day that comes back in an exchange, and what it is worth.
    return_date: date | None = None
    return_points: float | None = None


def _slots(slots: Iterable[Slot]) -> list[SwapSlotResponse]:
    return [SwapSlotResponse(service_date=day, role=role) for day, role in slots]


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
        slots=_slots(view.slots),
        return_slots=_slots(view.return_slots),
        warnings=rule_violation_responses(view.warnings),
        rule_violations=rule_violation_responses(view.rule_violations),
    )


def swap_option_response(option: ReplacementOption) -> SwapOptionResponse:
    return SwapOptionResponse(
        member_id=option.member.id,
        display_name=option.member.display_name,
        availability=option.availability,
        on_duty_that_day=option.on_duty_that_day,
        slots=_slots(option.slots),
        blocking_violations=rule_violation_responses(option.blocking_violations),
        rule_violations=rule_violation_responses(option.rule_violations),
        warning_violations=rule_violation_responses(option.warning_violations),
        next_step=option.next_step,
    )


def swap_return_option_response(option: ReturnOption) -> SwapReturnOptionResponse:
    return SwapReturnOptionResponse(
        service_date=option.service_date,
        role=option.role,
        slots=_slots(option.slots),
        blocking_violations=rule_violation_responses(option.blocking_violations),
        rule_violations=rule_violation_responses(option.rule_violations),
        warning_violations=rule_violation_responses(option.warning_violations),
    )
