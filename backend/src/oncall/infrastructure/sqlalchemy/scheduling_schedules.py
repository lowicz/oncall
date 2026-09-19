"""SQLAlchemy persistence for schedule plans and their assignments."""

import uuid
from collections.abc import Iterable
from datetime import date, datetime

from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from oncall.domain.roster import Slot
from oncall.domain.scheduling.models import (
    HISTORY_IMPORT_PREFIX,
    CarriedChange,
    CoveredSpan,
    Plan,
    PlannedDuty,
    PlanSummary,
)
from oncall.domain.scheduling.ports import NewDraft, Plans, StoredPlan
from oncall.domain.team import Member
from oncall.domain.vocabulary import ScheduleStatus
from oncall.models import Assignment, Schedule

#: PostgreSQL advisory lock serialising publication of overlapping ranges.
PUBLICATION_LOCK_KEY = 20260902


def _to_plan(row: Schedule) -> Plan:
    """Map a schedule whose assignments have already been loaded."""
    return Plan(
        id=row.id,
        name=row.name,
        starts_on=row.starts_on,
        ends_on=row.ends_on,
        status=row.status,
        version=row.version,
        created_at=row.created_at,
        rotation_mode=row.rotation_mode,
        solver_status=row.solver_status,
        acceptance_floor=row.acceptance_floor,
        fairness_proven=row.fairness_proven,
        continuity_gap=row.continuity_gap,
        solver_warnings=tuple(row.solver_warnings or ()),
        assignments=tuple(
            PlannedDuty(
                service_date=item.service_date,
                role=item.role,
                assignee_name=item.assignee_name,
                member_id=item.member_id,
                is_override=item.is_override,
            )
            for item in row.assignments
        ),
    )


def _with_assignments():
    # Status may be changed by UPDATE, so repeated reads refresh loaded rows.
    return (
        select(Schedule)
        .options(selectinload(Schedule.assignments))
        .execution_options(populate_existing=True)
    )


class SqlAlchemyPlans(Plans):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._rows: dict[uuid.UUID, Schedule] = {}

    async def _one(self, schedule_id: uuid.UUID, *, for_update: bool = False) -> Plan | None:
        query = _with_assignments().where(Schedule.id == schedule_id)
        if for_update:
            query = query.with_for_update()
        row = await self._session.scalar(query)
        if row is None:
            return None
        self._rows[row.id] = row
        return _to_plan(row)

    async def plan(self, schedule_id: uuid.UUID) -> Plan | None:
        return await self._one(schedule_id)

    async def plans(self, schedule_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, Plan]:
        rows = (
            (await self._session.scalars(_with_assignments().where(Schedule.id.in_(schedule_ids))))
            .unique()
            .all()
        )
        return {row.id: _to_plan(row) for row in rows}

    async def plan_to_correct(self, schedule_id: uuid.UUID) -> Plan | None:
        return await self._one(schedule_id, for_update=True)

    async def plan_to_publish(self, schedule_id: uuid.UUID) -> Plan | None:
        return await self._one(schedule_id, for_update=True)

    async def hold_publication(self) -> None:
        bind = self._session.bind
        if bind is not None and bind.dialect.name == "postgresql":
            await self._session.execute(
                text(f"SELECT pg_advisory_xact_lock({PUBLICATION_LOCK_KEY})")
            )

    async def open_drafts(self, limit: int) -> list[PlanSummary]:
        rows = (
            (
                await self._session.scalars(
                    select(Schedule)
                    .options(selectinload(Schedule.assignments))
                    .where(Schedule.status.in_((ScheduleStatus.draft, ScheduleStatus.proposed)))
                    .order_by(Schedule.starts_on.desc())
                    .limit(limit)
                )
            )
            .unique()
            .all()
        )
        return [
            PlanSummary(
                id=row.id,
                name=row.name,
                starts_on=row.starts_on,
                ends_on=row.ends_on,
                status=row.status,
                version=row.version,
                rotation_mode=row.rotation_mode,
                solver_status=row.solver_status,
                assignment_count=len(row.assignments),
                created_at=row.created_at,
            )
            for row in rows
        ]

    async def covering_spans(self, ending_on_or_after: date) -> list[CoveredSpan]:
        rows = (
            await self._session.scalars(
                select(Schedule)
                .where(
                    (
                        (Schedule.status == ScheduleStatus.published)
                        | Schedule.name.startswith(HISTORY_IMPORT_PREFIX)
                    ),
                    Schedule.ends_on >= ending_on_or_after,
                )
                .order_by(Schedule.starts_on, Schedule.ends_on)
            )
        ).all()
        return [CoveredSpan(row.starts_on, row.ends_on) for row in rows]

    async def published_overlapping(self, plan: Plan) -> dict[uuid.UUID, CoveredSpan]:
        rows = (
            await self._session.execute(
                select(Schedule.id, Schedule.starts_on, Schedule.ends_on).where(
                    Schedule.id != plan.id,
                    Schedule.status == ScheduleStatus.published,
                    Schedule.starts_on <= plan.ends_on,
                    Schedule.ends_on >= plan.starts_on,
                )
            )
        ).all()
        return {row.id: CoveredSpan(row.starts_on, row.ends_on) for row in rows}

    async def store_draft(self, draft: NewDraft) -> StoredPlan:
        result = draft.result
        schedule = Schedule(
            name=draft.name,
            starts_on=draft.starts_on,
            ends_on=draft.ends_on,
            status=ScheduleStatus.draft,
            rotation_mode=draft.rotation_mode,
            solver_status=result.status,
            acceptance_floor=result.acceptance_floor,
            fairness_proven=result.fairness_proven,
            continuity_gap=result.continuity_gap,
            solver_warnings=list(result.warnings),
            assignments=[
                Assignment(
                    service_date=item.service_date,
                    role=item.role,
                    assignee_name=item.assignee_name,
                    member_id=member_id,
                    is_override=False,
                )
                for item, member_id in draft.assignments
            ],
        )
        self._session.add(schedule)
        # The id is assigned when the unit of work writes the new row.
        return schedule

    async def correct(self, schedule_id: uuid.UUID, slot: Slot, to: Member) -> None:
        row = self._rows[schedule_id]
        assignment = next(
            item for item in row.assignments if (item.service_date, item.role) == slot
        )
        assignment.assignee_name = to.display_name
        assignment.member_id = to.id
        assignment.is_override = True
        row.version += 1

    async def change_status(
        self,
        schedule_id: uuid.UUID,
        *,
        from_status: ScheduleStatus,
        to_status: ScheduleStatus,
        expected_version: int,
    ) -> bool:
        result = await self._session.execute(
            update(Schedule)
            .where(
                Schedule.id == schedule_id,
                Schedule.status == from_status,
                Schedule.version == expected_version,
            )
            .values(status=to_status, version=Schedule.version + 1)
            .returning(Schedule.id)
        )
        return result.scalar_one_or_none() is not None

    async def delete(self, schedule_id: uuid.UUID) -> None:
        # Assignments follow through the Schedule.assignments cascade.
        await self._session.delete(self._rows.pop(schedule_id))

    async def carry(self, schedule_id: uuid.UUID, changes: list[CarriedChange]) -> None:
        row = self._rows[schedule_id]
        assignments = {(item.service_date, item.role): item for item in row.assignments}
        for change in changes:
            assignment = assignments[change.slot]
            assignment.assignee_name = change.assignee_name
            assignment.member_id = change.member_id
            assignment.is_override = True

    async def retire_covered_by(self, plan: Plan) -> None:
        await self._session.execute(
            update(Schedule)
            .where(
                Schedule.id != plan.id,
                Schedule.status == ScheduleStatus.published,
                Schedule.starts_on >= plan.starts_on,
                Schedule.ends_on <= plan.ends_on,
            )
            .values(status=ScheduleStatus.superseded, version=Schedule.version + 1)
        )

    async def mark_published(
        self, schedule_id: uuid.UUID, *, name: str, published_at: datetime
    ) -> None:
        row = self._rows[schedule_id]
        row.status = ScheduleStatus.published
        row.version += 1
        row.published_at = published_at
        if row.name != name:
            row.name = name


__all__ = ["PUBLICATION_LOCK_KEY", "SqlAlchemyPlans"]
