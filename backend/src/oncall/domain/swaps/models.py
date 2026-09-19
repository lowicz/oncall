import uuid
from dataclasses import dataclass
from datetime import date, datetime

from oncall.domain.roster import Slot
from oncall.domain.team import Actor, Member
from oncall.domain.vocabulary import AssignmentRole, AvailabilityKind, SwapStatus
from oncall.fairness import MemberBalance
from oncall.rules import RuleViolation

ACTIVE_SWAP_STATUSES = (SwapStatus.pending_replacement, SwapStatus.pending_coordinator)


@dataclass(frozen=True)
class SwapRequestInput:
    actor: Actor
    service_date: date
    role: AssignmentRole
    replacement_member_id: uuid.UUID
    note: str | None = None


@dataclass(frozen=True)
class SwapDecisionInput:
    actor: Actor
    swap_id: uuid.UUID
    #: Why the request is rejected or withdrawn; unused on accept and approve.
    reason: str | None = None


@dataclass(frozen=True)
class ReplacementOptionsQuery:
    actor: Actor
    service_date: date
    role: AssignmentRole


@dataclass(frozen=True)
class SwapImpactQuery:
    actor: Actor
    service_date: date
    role: AssignmentRole
    replacement_member_id: uuid.UUID


@dataclass(frozen=True)
class SwapListQuery:
    actor: Actor
    statuses: tuple[SwapStatus, ...] = ()
    limit: int = 100
    offset: int = 0


@dataclass(frozen=True)
class NewSwapRequest:
    schedule_id: uuid.UUID
    service_date: date
    role: AssignmentRole
    requester_member_id: uuid.UUID
    replacement_member_id: uuid.UUID
    schedule_version: int
    note: str | None
    slots: tuple[Slot, ...]
    status: SwapStatus = SwapStatus.pending_replacement


@dataclass(frozen=True)
class SwapRequest:
    id: uuid.UUID
    schedule_id: uuid.UUID
    service_date: date
    role: AssignmentRole
    requester_member_id: uuid.UUID
    replacement_member_id: uuid.UUID
    status: SwapStatus
    schedule_version: int
    note: str | None
    decision_note: str | None
    created_at: datetime
    #: The stored slots, as stored. Requests made before slots existed have
    #: none and move only their headline slot.
    slots: tuple[Slot, ...] = ()

    @property
    def moves(self) -> list[Slot]:
        return list(self.slots) or [(self.service_date, self.role)]

    @property
    def active(self) -> bool:
        return self.status in ACTIVE_SWAP_STATUSES


@dataclass(frozen=True)
class SwapRequestView:
    """A request with the names of both people, as a person reads it."""

    request: SwapRequest
    requester_name: str
    replacement_name: str
    #: Rules the swap bends without breaking; reported when it is created.
    warnings: tuple[RuleViolation, ...] = ()

    @property
    def slots(self) -> list[Slot]:
        return sorted(self.request.slots, key=lambda slot: (slot[0], slot[1].value)) or [
            (self.request.service_date, self.request.role)
        ]


@dataclass(frozen=True)
class SwapAutoCancelled:
    """The approval found a slot no longer held by the requester, so the
    request was cancelled instead. The cancellation is a stored outcome, not a
    failed operation."""

    swap_id: uuid.UUID


@dataclass(frozen=True)
class ReplacementOption:
    member: Member
    availability: AvailabilityKind | None
    on_duty_that_day: bool
    slots: tuple[Slot, ...]
    blocking_violations: tuple[RuleViolation, ...]
    warning_violations: tuple[RuleViolation, ...]
    next_step: str | None


@dataclass(frozen=True)
class SwapImpactSide:
    member_id: uuid.UUID
    display_name: str
    before: MemberBalance
    after: MemberBalance


@dataclass(frozen=True)
class SwapImpact:
    service_date: date
    role: AssignmentRole
    points: float
    window_start: date
    window_end: date
    requester: SwapImpactSide
    replacement: SwapImpactSide
    warnings: tuple[RuleViolation, ...]
