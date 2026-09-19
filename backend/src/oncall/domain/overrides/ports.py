import uuid
from dataclasses import dataclass
from datetime import date
from typing import Protocol

from oncall.domain.overrides.models import OverrideMove
from oncall.domain.ports import PublishedRoster, RosterPolicy, TeamDirectory
from oncall.domain.roster import Slot
from oncall.domain.vocabulary import AssignmentRole
from oncall.rules import RuleViolation


class OverrideJournal(Protocol):
    """Notifications and the audit trail for corrections, written in the name
    of the coordinator making them."""

    async def duty_overridden(
        self,
        *,
        schedule_id: uuid.UUID,
        service_date: date,
        role: AssignmentRole,
        previous_name: str,
        new_name: str,
        reason: str | None,
        historical: bool,
        moves: list[OverrideMove],
        violations: list[RuleViolation],
    ) -> None: ...

    async def duties_overridden_in_batch(
        self,
        *,
        schedule_id: uuid.UUID,
        slots: list[Slot],
        moves: list[OverrideMove],
        violations: list[RuleViolation],
        reason: str,
    ) -> None: ...


@dataclass(frozen=True)
class OverridePorts:
    team: TeamDirectory
    roster: PublishedRoster
    policy: RosterPolicy
    journal: OverrideJournal
