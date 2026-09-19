"""Shared HTTP representation of a roster assignment."""

from datetime import date

from pydantic import BaseModel

from oncall.domain.vocabulary import AssignmentRole
from oncall.presentation.rules import RuleViolationResponse


class AssignmentResponse(BaseModel):
    service_date: date
    role: AssignmentRole
    assignee_name: str
    is_override: bool
    rule_violations: list[RuleViolationResponse] = []


__all__ = ["AssignmentResponse"]
