"""HTTP contracts and edge mappers for direct roster overrides."""

import uuid
from datetime import date

from pydantic import BaseModel, ConfigDict, Field, model_validator

from oncall.domain.clock import business_today
from oncall.domain.overrides.models import DutyOverridden
from oncall.domain.vocabulary import AssignmentRole
from oncall.presentation.assignments import AssignmentResponse
from oncall.presentation.rules import rule_violation_responses


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
            raise ValueError("Korekta historyczna wymaga powodu (minimum 10 znaków)")
        return self


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


__all__ = [
    "BatchOverrideItem",
    "BatchOverrideRequest",
    "DirectOverrideCheckRequest",
    "DirectOverrideRequest",
    "override_assignment_response",
]
