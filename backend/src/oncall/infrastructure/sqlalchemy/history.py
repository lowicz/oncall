"""Imported duty history, stored as a superseded schedule with its audit entry."""

import uuid
from datetime import date

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from oncall.audit import record_audit
from oncall.domain.history.models import IMPORT_NAME_PREFIX, HistoryImport, NewHistoryImport
from oncall.domain.roster import Slot
from oncall.domain.team import Member
from oncall.domain.vocabulary import ScheduleStatus
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment, Schedule
from oncall.infrastructure.sqlalchemy.team import to_member
from oncall.infrastructure.sqlalchemy.team_models import TeamMember


class SqlAlchemyHistory:
    """Imported history and its audit entry over one session.

    One object implements both ports because the audit entry names the
    schedule just staged, with whatever id it has at that moment: none until
    the session flushes it. That is how imports have always been audited.
    """

    def __init__(self, session: AsyncSession, actor: User | None = None) -> None:
        self._session = session
        self._actor = actor
        self._staged: Schedule | None = None

    async def imports(self) -> list[HistoryImport]:
        rows = await self._session.execute(
            select(Schedule, func.count(Assignment.id))
            .outerjoin(Assignment, Assignment.schedule_id == Schedule.id)
            .where(
                Schedule.status == ScheduleStatus.superseded,
                Schedule.name.startswith(IMPORT_NAME_PREFIX.rstrip()),
            )
            .group_by(Schedule.id)
            .order_by(Schedule.created_at.desc())
        )
        return [
            HistoryImport(
                id=schedule.id,
                name=schedule.name.removeprefix(IMPORT_NAME_PREFIX),
                starts_on=schedule.starts_on,
                ends_on=schedule.ends_on,
                rows=count,
                created_at=schedule.created_at,
            )
            for schedule, count in rows.tuples()
        ]

    async def members(self) -> list[Member]:
        rows = await self._session.scalars(
            select(TeamMember).options(
                selectinload(TeamMember.eligibility), selectinload(TeamMember.availability)
            )
        )
        return [to_member(row) for row in rows.unique()]

    async def published_slots(self, starts_on: date, ends_on: date) -> set[Slot]:
        rows = await self._session.execute(
            select(Assignment.service_date, Assignment.role)
            .join(Schedule, Assignment.schedule_id == Schedule.id)
            .where(
                Schedule.status == ScheduleStatus.published,
                Assignment.service_date >= starts_on,
                Assignment.service_date <= ends_on,
            )
        )
        return set(rows.tuples())

    async def stage(self, history: NewHistoryImport) -> None:
        self._staged = Schedule(
            name=history.name,
            starts_on=history.starts_on,
            ends_on=history.ends_on,
            status=ScheduleStatus.superseded,
            published_at=history.published_at,
            assignments=[
                Assignment(
                    service_date=duty.service_date,
                    role=duty.role,
                    assignee_name=duty.assignee_name,
                    member_id=duty.member_id,
                    is_override=False,
                )
                for duty in history.duties
            ],
        )
        self._session.add(self._staged)

    async def staged_import_id(self) -> uuid.UUID:
        if self._staged is None:
            raise LookupError("no history import was staged")
        await self._session.flush()
        return self._staged.id

    async def imported(self, history: NewHistoryImport, *, filename: str, rows: int) -> None:
        record_audit(
            self._session,
            actor=self._actor,
            action="history.imported",
            entity_type="schedule",
            entity_id=self._staged.id if self._staged is not None else None,
            summary=(
                f"Zaimportowano historię z „{filename}”: "
                f"{rows} wierszy ({history.starts_on} – {history.ends_on})"
            ),
            details={"rows": rows},
        )
