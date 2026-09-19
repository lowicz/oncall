from dataclasses import dataclass
from datetime import date
from typing import Protocol

from oncall.domain.ports import FairnessHistory, RosterPolicy, TeamDirectory


class PublicationCalendar(Protocol):
    async def latest_publication_end(self) -> date | None:
        """The last day the most recent published schedule covers, however far."""
        ...


@dataclass(frozen=True)
class BalancePorts:
    team: TeamDirectory
    history: FairnessHistory
    policy: RosterPolicy
    publications: PublicationCalendar
