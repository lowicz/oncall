"""Notices to the person taking over a rotation role.

A segment is one person holding one role on consecutive service days of that
role: every day for PRIMARY and SECONDARY, Polish working days for 11–19,
which has no shift on the others. Whoever starts a segment is told twice, once
the reminder hour has come: on the last Polish working day before the segment
starts, and on its first day. The days inside a segment bring nothing, and the
person handing a role over is not written to.

The roles one person starts on the same day go out as one notice, each with
the last day of its own segment. A person moving from one role to another -
PRIMARY one week, SECONDARY the next - starts a new segment and is told again.
"""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from enum import StrEnum
from typing import Protocol

from oncall.domain.ports import PublishedRoster
from oncall.domain.roster import Duty, Slot
from oncall.domain.vocabulary import AssignmentRole
from oncall.workdays import is_polish_working_day, next_working_day, previous_working_day

#: How far ahead the duties in force are read at once while a segment's end
#: is looked for: the longest range one generation covers.
_READ_AHEAD = timedelta(days=35)


class NoticeTiming(StrEnum):
    """Which of a segment's two notices this is."""

    #: On the last Polish working day before the segment starts.
    ahead = "d-1"
    #: On the segment's first day.
    same_day = "d0"


@dataclass(frozen=True)
class Segment:
    """One person holding one role, `starts_on` to `ends_on` inclusive."""

    role: AssignmentRole
    starts_on: date
    ends_on: date


@dataclass(frozen=True)
class RotationNotice:
    """What one person is told about the roles they start on one day."""

    timing: NoticeTiming
    starts_on: date
    assignee_name: str
    #: In the order a day's roles are read in: PRIMARY, SECONDARY, 11–19.
    segments: tuple[Segment, ...]


class HandoverNotices(Protocol):
    async def announce(self, notice: RotationNotice) -> int:
        """Queue the notice for its person unless the same timing of it was
        queued before; answers how many notices were queued now."""
        ...


@dataclass(frozen=True)
class HandoverPorts:
    roster: PublishedRoster
    notices: HandoverNotices


#: Who holds a slot: the member where there is one, the label otherwise.
Holder = uuid.UUID | str


def _holder(duty: Duty) -> Holder:
    return duty.member_id or duty.assignee_name


def _previous_service_day(day: date, role: AssignmentRole) -> date:
    if role is AssignmentRole.late_shift:
        return previous_working_day(day)
    return day - timedelta(days=1)


def _next_service_day(day: date, role: AssignmentRole) -> date:
    if role is AssignmentRole.late_shift:
        return next_working_day(day)
    return day + timedelta(days=1)


def announced_on(today: date) -> list[date]:
    """The days whose segments are told about today: today itself and, on a
    working day, every day up to and including the next working day."""
    if not is_polish_working_day(today):
        return [today]
    last = next_working_day(today)
    return [today + timedelta(days=offset) for offset in range((last - today).days + 1)]


class _DutiesInForce:
    """The duties in force from `first` on, read ahead as a walk needs them."""

    def __init__(self, roster: PublishedRoster, first: date) -> None:
        self._roster = roster
        self._unread = first
        self._duties: dict[Slot, Duty] = {}

    async def duty(self, day: date, role: AssignmentRole) -> Duty | None:
        while day >= self._unread:
            last = self._unread + _READ_AHEAD
            self._duties.update(await self._roster.duties_in_force(self._unread, last))
            self._unread = last + timedelta(days=1)
        return self._duties.get((day, role))

    async def held_by(self, day: date, role: AssignmentRole, holder: Holder) -> bool:
        duty = await self.duty(day, role)
        return duty is not None and _holder(duty) == holder

    async def segment_end(self, starts_on: date, role: AssignmentRole, holder: Holder) -> date:
        """The last service day of the role the holder keeps from `starts_on`."""
        end, following = starts_on, _next_service_day(starts_on, role)
        while await self.held_by(following, role, holder):
            end, following = following, _next_service_day(following, role)
        return end


async def notices_due(today: date, roster: PublishedRoster) -> list[RotationNotice]:
    """The notices owed today, by the day their segments start and then by name."""
    duties = _DutiesInForce(roster, previous_working_day(today))
    names: dict[tuple[date, Holder], str] = {}
    starting: dict[tuple[date, Holder], list[Segment]] = {}
    for day in announced_on(today):
        for role in AssignmentRole:
            duty = await duties.duty(day, role)
            if duty is None:
                continue
            holder = _holder(duty)
            if await duties.held_by(_previous_service_day(day, role), role, holder):
                continue
            ends_on = await duties.segment_end(day, role, holder)
            names[(day, holder)] = duty.assignee_name
            starting.setdefault((day, holder), []).append(Segment(role, day, ends_on))
    notices = [
        RotationNotice(
            timing=NoticeTiming.same_day if day == today else NoticeTiming.ahead,
            starts_on=day,
            assignee_name=names[(day, holder)],
            segments=tuple(segments),
        )
        for (day, holder), segments in starting.items()
    ]
    return sorted(notices, key=lambda notice: (notice.starts_on, notice.assignee_name))


async def remind_of_handover(now_local: datetime, reminder_hour: int, ports: HandoverPorts) -> int:
    """Queue the rotation notices owed today once the reminder hour has come;
    answers how many were queued now, so a repeated scan answers 0."""
    if now_local.hour < reminder_hour:
        return 0
    queued = 0
    for notice in await notices_due(now_local.date(), ports.roster):
        queued += await ports.notices.announce(notice)
    return queued
