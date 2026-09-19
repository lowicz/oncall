from dataclasses import dataclass
from datetime import date
from typing import Protocol

from oncall.domain.ports import PublishedRoster
from oncall.domain.reports.models import RosterEntry


class ReportRoster(Protocol):
    async def members_active_between(self, starts_on: date, ends_on: date) -> list[RosterEntry]:
        """Members whose rotation membership touches the range, by name."""
        ...


@dataclass(frozen=True)
class ReportPorts:
    members: ReportRoster
    roster: PublishedRoster
