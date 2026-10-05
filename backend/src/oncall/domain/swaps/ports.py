import uuid
from dataclasses import dataclass
from datetime import date
from typing import Protocol

from oncall.domain.ports import FairnessHistory, PublishedRoster, RosterPolicy, TeamDirectory
from oncall.domain.roster import Slot
from oncall.domain.swaps.models import NewSwapRequest, SwapRequest
from oncall.domain.vocabulary import SwapStatus
from oncall.rules import RuleViolation


class SwapRequestStore(Protocol):
    async def has_active_request_for(self, slot: Slot) -> bool:
        """Whether a pending request already moves this slot.

        The answer holds until the unit of work ends: a concurrent request for
        the same day waits here instead of racing past the check.
        """
        ...

    async def active_slots(self, first: date, last: date) -> set[Slot]:
        """The slots pending requests move between the two days, read without
        holding the days: what a form may still offer, not a reservation."""
        ...

    async def add(self, request: NewSwapRequest) -> SwapRequest: ...

    async def take_for_decision(self, swap_id: uuid.UUID) -> SwapRequest | None:
        """The request, held until the decision is stored, so two decisions on
        one request are taken one after the other."""
        ...

    async def record_decision(self, request: SwapRequest) -> None:
        """Store the request's new status, decision note and acknowledged
        rule violations."""
        ...

    async def requests(
        self,
        *,
        involving: uuid.UUID | None,
        statuses: tuple[SwapStatus, ...],
        limit: int,
        offset: int,
    ) -> list[SwapRequest]:
        """Newest first; `involving` limits them to one member's requests."""
        ...

    async def take_expired(self, today: date) -> list[SwapRequest]:
        """The open requests with a slot before `today`, in either direction,
        oldest first and each held until its closing is stored."""
        ...


class SwapJournal(Protocol):
    """What the rest of the team learns about a swap: notifications and the
    audit trail."""

    async def requested(
        self,
        request: SwapRequest,
        *,
        requester_name: str,
        replacement_name: str,
        warnings: list[RuleViolation],
        violations: list[RuleViolation],
    ) -> None:
        """`violations` are the hard rules the requester acknowledged; the
        same argument of `accepted` and `approved` names the ones the person
        deciding there did."""
        ...

    async def accepted(
        self,
        request: SwapRequest,
        *,
        requester_name: str,
        replacement_name: str,
        violations: list[RuleViolation],
    ) -> None: ...

    async def rejected(
        self,
        request: SwapRequest,
        *,
        requester_name: str,
        replacement_name: str,
        reason: str | None,
        by_coordinator: bool,
    ) -> None: ...

    async def cancelled(
        self,
        request: SwapRequest,
        *,
        requester_name: str,
        replacement_name: str,
        reason: str | None,
    ) -> None: ...

    async def approved(
        self,
        request: SwapRequest,
        *,
        requester_name: str,
        replacement_name: str,
        by_coordinator: bool,
        self_approved: bool,
        violations: list[RuleViolation],
    ) -> None:
        """The swap is in the schedule: approved by a coordinator, or written
        on the replacement's acceptance alone when the policy asks for no
        approval. `self_approved` only means something for a coordinator."""
        ...

    async def expired(
        self, request: SwapRequest, *, requester_name: str, replacement_name: str
    ) -> None:
        """The request was closed because its day passed. Audit only: nobody
        is written to about a duty that is already over."""
        ...


@dataclass(frozen=True)
class SwapPorts:
    """The ports a swap use case may call, passed as one argument."""

    team: TeamDirectory
    roster: PublishedRoster
    policy: RosterPolicy
    requests: SwapRequestStore
    journal: SwapJournal
    fairness: FairnessHistory


@dataclass(frozen=True)
class SwapExpiryPorts:
    """What closing the requests whose day has passed needs. There is no
    actor: the worker does it."""

    team: TeamDirectory
    requests: SwapRequestStore
    journal: SwapJournal
