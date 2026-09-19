"""Published duties, the policy they follow and the fairness history behind them."""

import uuid
from collections.abc import Iterable
from datetime import date

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.ports import FairnessHistory, PublishedRoster, RosterPolicy
from oncall.domain.roster import Duty, ScheduleRef, Slot
from oncall.domain.team import Member
from oncall.domain.vocabulary import LateShiftAnchor, RotationMode
from oncall.effective import EffectiveAssignment, effective_assignments
from oncall.fairness import FairnessDuty, FairnessMemberInput
from oncall.fairness_data import latest_publish_end, load_inputs
from oncall.models import Assignment, Schedule, ScheduleStatus
from oncall.policy import load_policy


def _from_assignment(row: Assignment) -> Duty:
    return Duty(
        service_date=row.service_date,
        role=row.role,
        member_id=row.member_id,
        assignee_name=row.assignee_name,
        is_override=row.is_override,
        schedule_id=row.schedule_id,
    )


def _from_effective(item: EffectiveAssignment) -> Duty:
    return Duty(
        service_date=item.service_date,
        role=item.role,
        member_id=item.member_id,
        assignee_name=item.assignee_name,
        is_override=item.is_override,
        schedule_id=item.schedule_id,
        schedule_version=item.schedule_version,
        schedule_status=item.schedule_status,
    )


class SqlAlchemyPublishedRoster(PublishedRoster):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._held_schedules: set[uuid.UUID] = set()

    async def duties_in_force(self, starts_on: date, ends_on: date) -> dict[Slot, Duty]:
        resolved = await effective_assignments(self._session, starts_on, ends_on)
        return {slot: _from_effective(item) for slot, item in resolved.items()}

    async def schedule(self, schedule_id: uuid.UUID) -> ScheduleRef | None:
        row = await self._session.get(Schedule, schedule_id)
        return ScheduleRef(row.id, row.status, row.version) if row is not None else None

    async def latest_publication_covering(self, day: date) -> ScheduleRef | None:
        row = await self._session.scalar(
            select(Schedule)
            .where(
                Schedule.status == ScheduleStatus.published,
                Schedule.starts_on <= day,
                Schedule.ends_on >= day,
            )
            .order_by(Schedule.published_at.desc())
        )
        return ScheduleRef(row.id, row.status, row.version) if row is not None else None

    async def _assignment(self, schedule_id: uuid.UUID, slot: Slot) -> Assignment | None:
        service_date, role = slot
        return await self._session.scalar(
            select(Assignment).where(
                Assignment.schedule_id == schedule_id,
                Assignment.service_date == service_date,
                Assignment.role == role,
            )
        )

    async def duty(self, schedule_id: uuid.UUID, slot: Slot) -> Duty | None:
        row = await self._assignment(schedule_id, slot)
        return _from_assignment(row) if row is not None else None

    async def duty_for_handover(self, schedule_id: uuid.UUID, slot: Slot) -> Duty | None:
        # Atomic hand-over: take the schedule row before reading its slots.
        # Every writer of a published slot moves the schedule's version, so it
        # already waits on this row; reading the slot afterwards means a change
        # committed first is seen here, and one arriving later finds a new
        # version and fails its own check. Locking the slots instead would take
        # the two rows in the opposite order to a coordinator override and
        # deadlock with it. NO KEY UPDATE leaves inserts that merely reference
        # the schedule free to proceed. SQLite serialises writers on its own
        # and ignores the clause.
        if schedule_id not in self._held_schedules:
            await self._session.execute(
                select(Schedule.id)
                .where(Schedule.id == schedule_id)
                .with_for_update(key_share=True)
            )
            self._held_schedules.add(schedule_id)
        return await self.duty(schedule_id, slot)

    async def advance_version(
        self,
        schedule_id: uuid.UUID,
        *,
        expected_version: int | None,
        only_if_published: bool,
    ) -> bool:
        criteria = [Schedule.id == schedule_id]
        if expected_version is not None:
            criteria.append(Schedule.version == expected_version)
        if only_if_published:
            criteria.append(Schedule.status == ScheduleStatus.published)
        result = await self._session.execute(
            update(Schedule).where(*criteria).values(version=Schedule.version + 1)
        )
        return result.rowcount == 1

    async def hand_over(self, schedule_id: uuid.UUID, slots: Iterable[Slot], to: Member) -> None:
        for slot in slots:
            row = await self._assignment(schedule_id, slot)
            if row is None:
                service_date, role = slot
                row = Assignment(schedule_id=schedule_id, service_date=service_date, role=role)
                self._session.add(row)
            # Identity travels with the slot; the name is only the label.
            row.assignee_name = to.display_name
            row.member_id = to.id
            row.is_override = True


class SqlAlchemyRosterPolicy(RosterPolicy):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def late_shift_anchor(self) -> LateShiftAnchor:
        return (await load_policy(self._session)).late_shift_anchor

    async def rotation_mode(self) -> RotationMode:
        return (await load_policy(self._session)).rotation_mode


class SqlAlchemyFairnessHistory(FairnessHistory):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def balance_inputs(
        self, window_start: date, window_end: date
    ) -> tuple[list[FairnessMemberInput], list[FairnessDuty]]:
        members, duties, _holidays = await load_inputs(self._session, window_start, window_end)
        return members, duties


class SqlAlchemyPublicationCalendar:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def latest_publication_end(self) -> date | None:
        return await latest_publish_end(self._session)
