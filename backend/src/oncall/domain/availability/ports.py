import uuid
from dataclasses import dataclass
from datetime import date
from typing import Protocol

from oncall.domain.availability.models import AvailabilityEntry, NewAvailabilityEntry
from oncall.domain.ports import PublishedRoster, TeamDirectory
from oncall.domain.roster import Duty
from oncall.domain.team import Member


class AvailabilityLedger(Protocol):
    async def overlapping_entry(
        self, member_id: uuid.UUID, starts_on: date, ends_on: date
    ) -> AvailabilityEntry | None:
        """An entry of this member sharing a day with the range, if any.

        The answer holds until the unit of work ends: a concurrent declaration
        for the same member waits here instead of racing past the check.
        """
        ...

    async def record(self, entry: NewAvailabilityEntry) -> None:
        """Stage the new entry; `recorded_entry` returns it as stored."""
        ...

    async def recorded_entry(self) -> AvailabilityEntry: ...

    async def entries(
        self, member_id: uuid.UUID, starts_on: date | None, ends_on: date | None
    ) -> list[AvailabilityEntry]:
        """The member's entries touching the range, by start date."""
        ...

    async def entry_to_withdraw(
        self, member_id: uuid.UUID, entry_id: uuid.UUID
    ) -> AvailabilityEntry | None:
        """The entry, held until the unit of work ends so it is withdrawn once."""
        ...

    async def remove(self, entry_id: uuid.UUID) -> None: ...


class AvailabilityJournal(Protocol):
    """Notifications and the audit trail for availability changes, written in
    the name of the account the operation acts for."""

    async def declared(
        self,
        *,
        member: Member,
        entry: NewAvailabilityEntry,
        on_behalf: bool,
        duty_conflicts: list[Duty],
    ) -> None: ...

    async def withdrawn(
        self, *, member: Member, entry: AvailabilityEntry, on_behalf: bool
    ) -> None: ...


@dataclass(frozen=True)
class AvailabilityReadPorts:
    team: TeamDirectory
    ledger: AvailabilityLedger


@dataclass(frozen=True)
class AvailabilityWritePorts:
    team: TeamDirectory
    roster: PublishedRoster
    ledger: AvailabilityLedger
    journal: AvailabilityJournal


# Compatibility alias for callers not yet migrated to capability-specific ports.
AvailabilityPorts = AvailabilityWritePorts
