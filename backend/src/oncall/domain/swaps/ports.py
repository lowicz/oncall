import uuid
from dataclasses import dataclass
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

    async def add(self, request: NewSwapRequest) -> SwapRequest: ...

    async def take_for_decision(self, swap_id: uuid.UUID) -> SwapRequest | None:
        """The request, held until the decision is stored, so two decisions on
        one request are taken one after the other."""
        ...

    async def record_decision(self, request: SwapRequest) -> None:
        """Store the request's new status and decision note."""
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
    ) -> None: ...

    async def accepted(
        self, request: SwapRequest, *, requester_name: str, replacement_name: str
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
        self_approved: bool,
    ) -> None: ...


@dataclass(frozen=True)
class SwapPorts:
    """The ports a swap use case may call, passed as one argument."""

    team: TeamDirectory
    roster: PublishedRoster
    policy: RosterPolicy
    requests: SwapRequestStore
    journal: SwapJournal
    fairness: FairnessHistory
