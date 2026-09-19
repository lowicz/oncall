import uuid
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date
from typing import Any, Protocol

from oncall.domain.calendar.models import CalendarEvent, CalendarMember, Contact, NewCalendarEvent
from oncall.domain.ports import PublishedRoster
from oncall.domain.vocabulary import AssignmentRole


class CalendarEvents(Protocol):
    async def events_between(
        self, starts_on: date, ends_on: date, *, by_start: bool
    ) -> list[CalendarEvent]:
        """Events touching the range; by start and title when asked, as
        stored otherwise."""
        ...

    async def event(self, event_id: uuid.UUID) -> CalendarEvent | None:
        """The event as it is stored now."""
        ...

    async def add(self, event: NewCalendarEvent) -> CalendarEvent: ...

    async def change(self, event_id: uuid.UUID, changes: dict[str, Any]) -> CalendarEvent: ...

    async def remove(self, event_id: uuid.UUID) -> None: ...


class CalendarJournal(Protocol):
    async def event_created(self, event: CalendarEvent) -> None: ...

    async def event_updated(self, event: CalendarEvent, *, changes: dict[str, Any]) -> None: ...

    async def event_deleted(self, event: CalendarEvent) -> None: ...


class CalendarRoster(Protocol):
    async def members_for_range(
        self, starts_on: date, ends_on: date, holding: Iterable[uuid.UUID]
    ) -> list[CalendarMember]:
        """Members active in the range, plus anyone holding a duty in it, by name."""
        ...

    async def approved_swap_slots(
        self, starts_on: date, ends_on: date
    ) -> set[tuple[uuid.UUID, date, AssignmentRole]]: ...

    async def published_ranges(self, starts_on: date, ends_on: date) -> list[tuple[date, date]]: ...

    async def contacts(self) -> list[Contact]:
        """Every member, with their account's contact details."""
        ...


@dataclass(frozen=True)
class CalendarPorts:
    events: CalendarEvents
    journal: CalendarJournal
    roster: PublishedRoster
    calendar: CalendarRoster
