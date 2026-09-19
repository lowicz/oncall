import uuid
from dataclasses import dataclass
from datetime import date
from typing import Protocol

from oncall.domain.history.models import HistoryImport, NewHistoryImport
from oncall.domain.roster import Slot
from oncall.domain.team import Member


class HistoryArchive(Protocol):
    async def imports(self) -> list[HistoryImport]:
        """Newest first."""
        ...

    async def members(self) -> list[Member]:
        """Everyone ever in the rotation, with their eligibility."""
        ...

    async def published_slots(self, starts_on: date, ends_on: date) -> set[Slot]:
        """Slots a published schedule holds in the range."""
        ...

    async def stage(self, history: NewHistoryImport) -> None:
        """Stage the import; `staged_import_id` returns its id once stored."""
        ...

    async def staged_import_id(self) -> uuid.UUID: ...


class HistoryJournal(Protocol):
    async def imported(self, history: NewHistoryImport, *, filename: str, rows: int) -> None: ...


@dataclass(frozen=True)
class HistoryPorts:
    archive: HistoryArchive
    journal: HistoryJournal
