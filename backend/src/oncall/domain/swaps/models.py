import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Literal

from oncall.domain.roster import Slot
from oncall.domain.team import Actor, Member
from oncall.domain.vocabulary import AssignmentRole, AvailabilityKind, SwapStatus
from oncall.fairness import MemberBalance
from oncall.rules import RuleViolation

ACTIVE_SWAP_STATUSES = (SwapStatus.pending_replacement, SwapStatus.pending_coordinator)

#: Why an approval turned into an automatic cancellation; stored on the request,
#: so it is written in the recorded language.
SLOT_CHANGED_OWNER_NOTE = "Slot zmienił właściciela przed zatwierdzeniem"

#: How far ahead the duties offered in return are read: as far as the
#: calendar shows at once.
RETURN_HORIZON = timedelta(days=90)

#: The two people of a request, by the side they are on.
SwapParty = Literal["requester", "replacement"]


@dataclass(frozen=True)
class AcknowledgedViolation:
    """A hard rule a swap breaks knowingly, as the request keeps it. The
    person is named by their side of the request, so the record carries no
    name of its own and outlives the audit trail."""

    rule: str
    party: SwapParty
    days: tuple[date, ...]


def acknowledged_violations(
    violations: list[RuleViolation], *, requester_name: str
) -> tuple[AcknowledgedViolation, ...]:
    """The violations as a request keeps them. A swap's rule check reports
    its two people only, so whoever is not the requester is the replacement."""
    return tuple(
        AcknowledgedViolation(
            item.rule,
            "requester" if item.member_name == requester_name else "replacement",
            item.days,
        )
        for item in violations
    )


@dataclass(frozen=True)
class SwapReturn:
    """The duty the requester takes in exchange, and the schedule that holds
    it. The two days of an exchange may lie in different publications."""

    schedule_id: uuid.UUID
    #: The duty asked for first, then the 11-19 slot that travels with it.
    slots: tuple[Slot, ...]


@dataclass(frozen=True)
class SwapTransfer:
    """One slot a swap moves: where it is, who gives it up and who takes it."""

    schedule_id: uuid.UUID
    slot: Slot
    giver: Member
    taker: Member


@dataclass(frozen=True)
class SwapRequestInput:
    actor: Actor
    service_date: date
    role: AssignmentRole
    replacement_member_id: uuid.UUID
    #: Why the swap is needed; required once it breaks a hard rule.
    note: str | None = None
    acknowledge_rule_violations: bool = False
    #: A duty of the replacement the requester takes in exchange.
    in_return: Slot | None = None


@dataclass(frozen=True)
class SwapDecisionInput:
    actor: Actor
    swap_id: uuid.UUID
    #: Why the request is rejected or withdrawn; unused on accept and approve.
    reason: str | None = None
    #: Accept and approve only: the person deciding has seen the hard rules
    #: the swap breaks on the roster as it is now.
    acknowledge_rule_violations: bool = False


@dataclass(frozen=True)
class ReplacementOptionsQuery:
    actor: Actor
    service_date: date
    role: AssignmentRole


@dataclass(frozen=True)
class ReturnOptionsQuery:
    """The duty the actor gives away and the colleague asked to take it."""

    actor: Actor
    service_date: date
    role: AssignmentRole
    replacement_member_id: uuid.UUID


@dataclass(frozen=True)
class SwapImpactQuery:
    actor: Actor
    service_date: date
    role: AssignmentRole
    replacement_member_id: uuid.UUID
    #: A duty of the replacement that goes back to the holder in exchange.
    in_return: Slot | None = None
    #: A coordinator's correction rather than a swap: it carries 11-19 along
    #: only from its anchor role, where a swap couples the pair from either.
    correction: bool = False


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
    rule_violations: tuple[AcknowledgedViolation, ...] = ()
    in_return: SwapReturn | None = None


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
    #: The hard rules acknowledged at the latest step that asked for it: the
    #: request, the acceptance, the approval.
    rule_violations: tuple[AcknowledgedViolation, ...] = ()
    #: What the requester takes in exchange; None for a one-way hand-over.
    in_return: SwapReturn | None = None

    @property
    def moves(self) -> list[Slot]:
        """The slots the requester gives to the replacement."""
        return list(self.slots) or [(self.service_date, self.role)]

    @property
    def return_moves(self) -> list[Slot]:
        """The slots the requester takes from the replacement in exchange."""
        return list(self.in_return.slots) if self.in_return is not None else []

    @property
    def all_moves(self) -> list[Slot]:
        """Every slot the request moves, in either direction."""
        return self.moves + self.return_moves

    def transfers(self, requester: Member, replacement: Member) -> list[SwapTransfer]:
        """Every slot the request moves, with the schedule that holds it, the
        person it leaves and the person it goes to."""
        given = [
            SwapTransfer(self.schedule_id, slot, requester, replacement) for slot in self.moves
        ]
        if self.in_return is None:
            return given
        return given + [
            SwapTransfer(self.in_return.schedule_id, slot, replacement, requester)
            for slot in self.in_return.slots
        ]

    def named_violations(
        self, requester_name: str, replacement_name: str
    ) -> tuple[RuleViolation, ...]:
        """The acknowledged violations with each side's name put back."""
        names: dict[SwapParty, str] = {"requester": requester_name, "replacement": replacement_name}
        return tuple(
            RuleViolation(item.rule, names[item.party], item.days) for item in self.rule_violations
        )

    @property
    def active(self) -> bool:
        return self.status in ACTIVE_SWAP_STATUSES


@dataclass(frozen=True)
class SwapRequestView:
    """A request with the names of both people, as a person reads it."""

    request: SwapRequest
    requester_name: str
    replacement_name: str
    #: Rules the swap bends without breaking: reported when it is created
    #: and, for a request still open, on the roster as it is now.
    warnings: tuple[RuleViolation, ...] = ()
    #: Hard rules the swap breaks: on the roster as it is now while the
    #: request is open, as last acknowledged once it is decided.
    rule_violations: tuple[RuleViolation, ...] = ()

    @property
    def slots(self) -> list[Slot]:
        """What the requester gives, the on-call role before its 11-19."""
        return self.request.moves

    @property
    def return_slots(self) -> list[Slot]:
        """What the requester takes in exchange, in the same order."""
        return self.request.return_moves


@dataclass(frozen=True)
class SwapPolicy:
    """What the swap screens need to know about the policy: whether a request
    the replacement accepts still waits for a coordinator."""

    coordinator_approval_required: bool


@dataclass(frozen=True)
class SwapAutoCancelled:
    """The hand-over found a slot no longer held by the requester, so the
    request was cancelled instead. The cancellation is a stored outcome, not a
    failed operation."""

    swap_id: uuid.UUID


@dataclass(frozen=True)
class ReplacementOption:
    member: Member
    availability: AvailabilityKind | None
    on_duty_that_day: bool
    slots: tuple[Slot, ...]
    #: Rules that rule the candidate out.
    blocking_violations: tuple[RuleViolation, ...]
    #: Rules a request to this candidate breaks and has to acknowledge.
    rule_violations: tuple[RuleViolation, ...]
    warning_violations: tuple[RuleViolation, ...]
    next_step: str | None


@dataclass(frozen=True)
class ReturnOption:
    """A duty of the replacement the requester could take in exchange, with
    what the whole exchange - both directions - would break or bend."""

    #: The duty as it is asked for; `slots` adds the 11-19 that travels with it.
    service_date: date
    role: AssignmentRole
    slots: tuple[Slot, ...]
    #: Rules that rule the exchange out.
    blocking_violations: tuple[RuleViolation, ...]
    #: Rules the exchange breaks and the request has to acknowledge.
    rule_violations: tuple[RuleViolation, ...]
    warning_violations: tuple[RuleViolation, ...]


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
    #: The day that comes back in an exchange, and what it is worth.
    return_date: date | None = None
    return_points: float | None = None
