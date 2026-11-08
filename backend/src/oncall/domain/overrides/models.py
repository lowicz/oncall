import uuid
from dataclasses import dataclass
from datetime import date
from enum import StrEnum

from oncall.domain.swaps.models import SwapImpactSide
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
    #: The coordinator has seen the hard rules this correction breaks and
    #: goes ahead anyway; without it such a correction is refused.
    acknowledge_rule_violations: bool = False


class BatchOverrideKind(StrEnum):
    """What one batch decision is, which decides its reason, audit and e-mail."""

    #: Any set of slots (offboarding): always with a reason.
    correction = "correction"
    #: The PRIMARY and SECONDARY holders of one day trade places: a reason
    #: only for a past day, like a single correction.
    role_swap = "role_swap"
    #: The roles of one day the coordinator hands over in one correction
    #: (P7): PRIMARY or SECONDARY and 11-19, each to the person on its line, a
    #: reason only for a past day, audited and e-mailed like a single
    #: correction.
    multi_role = "multi_role"


@dataclass(frozen=True)
class BatchOverrideLine:
    service_date: date
    role: AssignmentRole
    replacement_member_id: uuid.UUID
    #: The coordinator takes 11-19 along with this anchor role, as a single
    #: correction does by itself (`_couples_late_shift`).
    with_late_shift: bool = False


@dataclass(frozen=True)
class BatchOverrideCheck:
    schedule_id: uuid.UUID
    lines: tuple[BatchOverrideLine, ...]


@dataclass(frozen=True)
class BatchOverrideInput:
    actor: Actor
    schedule_id: uuid.UUID
    expected_version: int
    lines: tuple[BatchOverrideLine, ...]
    reason: str | None = None
    acknowledge_rule_violations: bool = False
    kind: BatchOverrideKind = BatchOverrideKind.correction


@dataclass(frozen=True)
class OverrideMove:
    """One slot a correction moved, and who held it before - what a later
    republish needs to tell a safe carry from a conflict."""

    service_date: date
    role: AssignmentRole
    previous_assignee_name: str


#: One slot as a correction changed hands: day, role, who held it, who has it
#: now. The shape the notification templates list.
AssignmentChange = tuple[date, AssignmentRole, str, str]


@dataclass(frozen=True)
class DutyOverridden:
    service_date: date
    role: AssignmentRole
    assignee_name: str
    #: Hard rules the correction knowingly broke.
    violations: tuple[RuleViolation, ...]


@dataclass(frozen=True)
class CorrectionImpact:
    """What a correction does to the balance of everybody it moves a slot
    from or to, in the fairness report's window."""

    service_date: date
    #: What the first corrected day is worth.
    points: float
    window_start: date
    window_end: date
    #: The people taking slots first, then the people giving them up.
    members: list[SwapImpactSide]
