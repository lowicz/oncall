import uuid
from dataclasses import dataclass
from datetime import date
from typing import Protocol

from oncall.domain.availability.models import (
    AvailabilityEntry,
    NewAvailabilityEntry,
    RangeSnapshot,
)
from oncall.domain.ports import PublishedRoster, TeamDirectory
from oncall.domain.roster import Duty
from oncall.domain.team import Member


class AvailabilityLedger(Protocol):
    async def overlapping_entries(
        self, member_id: uuid.UUID, starts_on: date, ends_on: date
    ) -> list[AvailabilityEntry]:
        """Entries sharing a day with the range, held until the unit of work ends.

        Locking the member makes an empty result stable too, so a concurrent
        declaration or range replacement for that member waits.
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
        undo_id: uuid.UUID | None = None,
    ) -> None:
        """With an `undo_id` the e-mails wait for the Undo window."""
        ...

    async def withdrawn(
        self, *, member: Member, entry: AvailabilityEntry, on_behalf: bool
    ) -> None: ...

    async def restored(
        self, *, member: Member, entry: NewAvailabilityEntry, on_behalf: bool
    ) -> None:
        """An entry an Undo put back: audited, never announced."""
        ...

    async def undone(self, undo_id: uuid.UUID) -> None:
        """Withdraw the stroke's e-mails that are still waiting."""
        ...


class RangeSnapshots(Protocol):
    async def keep(self, snapshot: RangeSnapshot) -> None: ...

    async def take(
        self, undo_id: uuid.UUID, member_id: uuid.UUID, actor_user_id: uuid.UUID
    ) -> RangeSnapshot | None:
        """The snapshot, removed so it is restored once; None when it is not
        this account's stroke for this member, or is gone."""
        ...


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
    snapshots: RangeSnapshots
