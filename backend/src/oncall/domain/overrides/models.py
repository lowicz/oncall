import uuid
from dataclasses import dataclass
from datetime import date

from oncall.domain.team import Actor
from oncall.domain.vocabulary import AssignmentRole
from oncall.rules import RuleViolation

#: How the audit trail names a slot that had nobody in it.
UNSTAFFED = "brak obsady"

#: Shortest reason a historical or batch correction must carry.
MIN_REASON_LENGTH = 10


@dataclass(frozen=True)
class OverrideCheck:
    service_date: date
    role: AssignmentRole
    replacement_member_id: uuid.UUID
    schedule_id: uuid.UUID | None = None


@dataclass(frozen=True)
class OverrideInput:
    actor: Actor
    service_date: date
    role: AssignmentRole
    replacement_member_id: uuid.UUID
    expected_version: int
    schedule_id: uuid.UUID | None = None
    reason: str | None = None


@dataclass(frozen=True)
class BatchOverrideLine:
    service_date: date
    role: AssignmentRole
    replacement_member_id: uuid.UUID


@dataclass(frozen=True)
class BatchOverrideInput:
    actor: Actor
    schedule_id: uuid.UUID
    expected_version: int
    lines: tuple[BatchOverrideLine, ...]
    reason: str


@dataclass(frozen=True)
class OverrideMove:
    """One slot a correction moved, and who held it before - what a later
    republish needs to tell a safe carry from a conflict (QA7 par. 8, B3)."""

    service_date: date
    role: AssignmentRole
    previous_assignee_name: str


@dataclass(frozen=True)
class DutyOverridden:
    service_date: date
    role: AssignmentRole
    assignee_name: str
    #: Hard rules the correction knowingly broke.
    violations: tuple[RuleViolation, ...]
