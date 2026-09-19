"""Shared HTTP representation of a domain rule violation."""

from datetime import date

from pydantic import BaseModel

from oncall.rules import RuleViolation


class RuleViolationResponse(BaseModel):
    """One hard rule an edit would break (decision D3)."""

    rule: str
    message: str
    member_name: str
    days: list[date]


def rule_violation_responses(
    violations: tuple[RuleViolation, ...] | list[RuleViolation],
) -> list[RuleViolationResponse]:
    return [
        RuleViolationResponse(
            rule=item.rule,
            message=item.message,
            member_name=item.member_name,
            days=list(item.days),
        )
        for item in violations
    ]


__all__ = ["RuleViolationResponse", "rule_violation_responses"]
