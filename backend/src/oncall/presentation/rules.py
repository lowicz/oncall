"""Shared HTTP representation of a domain rule violation."""

from collections.abc import Iterable
from datetime import date

from pydantic import BaseModel, ConfigDict

from oncall.rules import RuleViolation


class RuleViolationResponse(BaseModel):
    """One hard rule an edit would break (decision D3)."""

    model_config = ConfigDict(from_attributes=True)

    rule: str
    message: str
    member_name: str
    days: list[date]


def rule_violation_responses(violations: Iterable[RuleViolation]) -> list[RuleViolationResponse]:
    return [RuleViolationResponse.model_validate(item) for item in violations]
