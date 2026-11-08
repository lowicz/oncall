"""HTTP contracts and edge mappers for direct roster overrides."""

import uuid
from datetime import date

from pydantic import BaseModel, ConfigDict, Field, model_validator

from oncall.domain.clock import business_today
from oncall.domain.forwarding.models import NumberHandover
from oncall.domain.overrides.models import DutyOverridden
from oncall.domain.vocabulary import AssignmentRole
from oncall.i18n import translate
from oncall.presentation.assignments import AssignmentResponse
from oncall.presentation.forwarding import HandoverResponse
from oncall.presentation.rules import RuleViolationResponse, rule_violation_responses
from oncall.rules import RuleViolation


class DirectOverrideRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schedule_id: uuid.UUID | None = None
    expected_version: int = Field(ge=1)
    service_date: date
    role: AssignmentRole
    replacement_member_id: uuid.UUID
    reason: str | None = Field(default=None, max_length=500)
    #: Required when the correction breaks a hard rule: the coordinator saw
    #: the violations (`/override/check`) and goes ahead knowingly.
    acknowledge_rule_violations: bool = False

    @model_validator(mode="after")
    def historical_reason_required(self) -> DirectOverrideRequest:
        if self.service_date < business_today() and len((self.reason or "").strip()) < 10:
            raise ValueError(translate("overrides.historical_correction_needs_reason"))
        return self


class OverrideCheckResponse(BaseModel):
    """What a correction would cause: the hard rules it breaks, which ask for
    acknowledgement, and the number handover it would end, which the frame
    only states."""

    violations: list[RuleViolationResponse]
    ends_handover: HandoverResponse | None


def override_check_response(
    violations: list[RuleViolation], ends_handover: NumberHandover | None
) -> OverrideCheckResponse:
    return OverrideCheckResponse(
        violations=rule_violation_responses(violations),
        ends_handover=(
            HandoverResponse.model_validate(ends_handover) if ends_handover is not None else None
        ),
    )


class DirectOverrideCheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schedule_id: uuid.UUID | None = None
    expected_version: int | None = Field(default=None, ge=1)
    service_date: date
    role: AssignmentRole
    replacement_member_id: uuid.UUID
    reason: str | None = Field(default=None, max_length=500)


class BatchOverrideItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    service_date: date
    role: AssignmentRole
    replacement_member_id: uuid.UUID


class BatchOverrideCheckBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schedule_id: uuid.UUID
    assignments: list[BatchOverrideItem] = Field(min_length=1, max_length=200)


class BatchOverrideCheckRequest(BaseModel):
    """The batches one decision will save, one per schedule, checked together."""

    model_config = ConfigDict(extra="forbid")

    batches: list[BatchOverrideCheckBatch] = Field(min_length=1, max_length=20)


class BatchOverrideRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schedule_id: uuid.UUID
    expected_version: int = Field(ge=1)
    assignments: list[BatchOverrideItem] = Field(min_length=1, max_length=200)
    reason: str = Field(min_length=10, max_length=500)
    acknowledge_rule_violations: bool = False


def override_assignment_response(result: DutyOverridden) -> AssignmentResponse:
    return AssignmentResponse(
        service_date=result.service_date,
        role=result.role,
        assignee_name=result.assignee_name,
        is_override=True,
        rule_violations=rule_violation_responses(result.violations),
    )
