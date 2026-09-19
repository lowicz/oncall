"""The published roster: slots, the duty holding each one, and the checks
that project a change onto it."""

import uuid
from dataclasses import dataclass
from datetime import date, timedelta

from oncall.domain.vocabulary import AssignmentRole, LateShiftAnchor, ScheduleStatus

#: One roster position: a role on a day.
Slot = tuple[date, AssignmentRole]

#: The on-call role opposite each on-call role; nobody may hold both on a day.
OPPOSITE_ONCALL = {
    AssignmentRole.primary: AssignmentRole.secondary,
    AssignmentRole.secondary: AssignmentRole.primary,
}

#: Margin loaded around a change so every rule sees its whole window: the
#: 3-in-7 window on both sides plus the ends of a day-off block touching a slot.
RULE_WINDOW_MARGIN = timedelta(days=10)


@dataclass(frozen=True)
class Duty:
    """Who holds one slot of one schedule."""

    service_date: date
    role: AssignmentRole
    #: None for rows that predate the identity column or name somebody who was
    #: never a team member (imported history); the name is then the identity.
    member_id: uuid.UUID | None
    assignee_name: str
    is_override: bool
    schedule_id: uuid.UUID
    #: The version of the schedule the duty comes from, where the reader
    #: resolved it (the duties in force); a calendar entry changes with it.
    schedule_version: int | None = None
    schedule_status: ScheduleStatus | None = None

    @property
    def slot(self) -> Slot:
        return (self.service_date, self.role)

    def held_by(self, member_id: uuid.UUID, display_name: str) -> bool:
        """Prefers the identity; falls back to the label only for rows that
        have no id, so a renamed member keeps their history."""
        if self.member_id is not None:
            return self.member_id == member_id
        return self.assignee_name == display_name


@dataclass(frozen=True)
class ScheduleRef:
    id: uuid.UUID
    status: ScheduleStatus
    version: int

    @property
    def published(self) -> bool:
        return self.status == ScheduleStatus.published


def anchor_role(anchor: LateShiftAnchor) -> AssignmentRole | None:
    """The on-call role the 11-19 shift travels with, if the policy binds one."""
    if anchor == LateShiftAnchor.primary:
        return AssignmentRole.primary
    if anchor == LateShiftAnchor.secondary:
        return AssignmentRole.secondary
    return None


def rule_window(days: list[date]) -> tuple[date, date]:
    return min(days) - RULE_WINDOW_MARGIN, max(days) + RULE_WINDOW_MARGIN


def holder_names(duties: dict[Slot, Duty]) -> dict[Slot, str]:
    """The roster as the hard rules read it: who holds each slot, by name."""
    return {slot: duty.assignee_name for slot, duty in duties.items()}
