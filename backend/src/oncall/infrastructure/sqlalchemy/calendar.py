import uuid
from collections.abc import Iterable
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload, selectinload

from oncall.audit import record_audit
from oncall.domain.calendar.models import (
    AvailabilityNote,
    CalendarEvent,
    CalendarMember,
    Contact,
    NewCalendarEvent,
)
from oncall.domain.team import RolePeriod
from oncall.domain.vocabulary import AssignmentRole, ScheduleStatus, SwapStatus
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.calendar_model import CalendarEvent as CalendarEventRow
from oncall.infrastructure.sqlalchemy.scheduling_models import Schedule
from oncall.infrastructure.sqlalchemy.swap_models import SwapRequest
from oncall.infrastructure.sqlalchemy.team_models import TeamMember


def _to_event(row: CalendarEventRow) -> CalendarEvent:
    return CalendarEvent(
        id=row.id,
        starts_on=row.starts_on,
        ends_on=row.ends_on,
        title=row.title,
        color=row.color,
        created_at=row.created_at,
    )


class SqlAlchemyCalendarEvents:
    def __init__(self, session: AsyncSession, actor: User | None = None) -> None:
        self._session = session
        self._actor = actor

    async def events_between(
        self, starts_on: date, ends_on: date, *, by_start: bool
    ) -> list[CalendarEvent]:
        query = select(CalendarEventRow).where(
            CalendarEventRow.starts_on <= ends_on, CalendarEventRow.ends_on >= starts_on
        )
        if by_start:
            query = query.order_by(CalendarEventRow.starts_on, CalendarEventRow.title)
        return [_to_event(row) for row in await self._session.scalars(query)]

    async def event(self, event_id: uuid.UUID) -> CalendarEvent | None:
        row = await self._session.scalar(
            select(CalendarEventRow)
            .where(CalendarEventRow.id == event_id)
            .execution_options(populate_existing=True)
        )
        return _to_event(row) if row is not None else None

    async def add(self, event: NewCalendarEvent) -> CalendarEvent:
        row = CalendarEventRow(
            starts_on=event.starts_on,
            ends_on=event.ends_on,
            title=event.title,
            color=event.color,
            created_by_id=event.actor.user_id,
        )
        self._session.add(row)
        await self._session.flush()
        return _to_event(row)

    async def change(self, event_id: uuid.UUID, changes: dict) -> CalendarEvent:
        row = await self._session.get(CalendarEventRow, event_id)
        for field, value in changes.items():
            setattr(row, field, value)
        return _to_event(row)

    async def remove(self, event_id: uuid.UUID) -> None:
        await self._session.delete(await self._session.get(CalendarEventRow, event_id))

    async def event_created(self, event: CalendarEvent) -> None:
        record_audit(
            self._session,
            actor=self._actor,
            action="calendar.event_created",
            entity_type="calendar_event",
            entity_id=event.id,
            summary=f"Utworzono wydarzenie „{event.title}” ({event.starts_on} - {event.ends_on})",
            details={"color": event.color.value},
        )

    async def event_updated(self, event: CalendarEvent, *, changes: dict) -> None:
        record_audit(
            self._session,
            actor=self._actor,
            action="calendar.event_updated",
            entity_type="calendar_event",
            entity_id=event.id,
            summary=f"Zmieniono wydarzenie „{event.title}”",
            details={key: str(value) for key, value in changes.items()},
        )

    async def event_deleted(self, event: CalendarEvent) -> None:
        record_audit(
            self._session,
            actor=self._actor,
            action="calendar.event_deleted",
            entity_type="calendar_event",
            entity_id=event.id,
            summary=f"Usunięto wydarzenie „{event.title}”",
        )


class SqlAlchemyCalendarRoster:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def members_for_range(
        self, starts_on: date, ends_on: date, holding: Iterable[uuid.UUID]
    ) -> list[CalendarMember]:
        rows = await self._session.scalars(
            select(TeamMember)
            .options(joinedload(TeamMember.availability), joinedload(TeamMember.eligibility))
            .where(
                TeamMember.active_from <= ends_on,
                (
                    TeamMember.active_until.is_(None)
                    | (TeamMember.active_until >= starts_on)
                    | TeamMember.id.in_(set(holding))
                ),
            )
            .order_by(TeamMember.display_name)
        )
        return [
            CalendarMember(
                id=row.id,
                display_name=row.display_name,
                user_id=row.user_id,
                active_from=row.active_from,
                active_until=row.active_until,
                eligibility=tuple(
                    RolePeriod(item.role, item.starts_on, item.ends_on) for item in row.eligibility
                ),
                availability=tuple(
                    AvailabilityNote(item.kind, item.starts_on, item.ends_on, item.note)
                    for item in row.availability
                ),
            )
            for row in rows.unique()
        ]

    async def has_any_members(self) -> bool:
        return (await self._session.scalar(select(TeamMember.id).limit(1))) is not None

    async def approved_swap_slots(
        self, starts_on: date, ends_on: date
    ) -> set[tuple[uuid.UUID, date, AssignmentRole]]:
        rows = await self._session.execute(
            select(SwapRequest.schedule_id, SwapRequest.service_date, SwapRequest.role).where(
                SwapRequest.status == SwapStatus.approved,
                SwapRequest.service_date >= starts_on,
                SwapRequest.service_date <= ends_on,
            )
        )
        return set(rows.tuples())

    async def published_ranges(self, starts_on: date, ends_on: date) -> list[tuple[date, date]]:
        rows = await self._session.execute(
            select(Schedule.starts_on, Schedule.ends_on).where(
                Schedule.status == ScheduleStatus.published,
                Schedule.starts_on <= ends_on,
                Schedule.ends_on >= starts_on,
            )
        )
        return list(rows.tuples())

    async def contacts(self) -> list[Contact]:
        rows = await self._session.scalars(
            select(TeamMember).options(selectinload(TeamMember.user))
        )
        return [
            Contact(
                member_id=row.id,
                display_name=row.display_name,
                email=row.user.email if row.user is not None else None,
                phone=row.user.phone if row.user is not None else None,
            )
            for row in rows.unique()
        ]
