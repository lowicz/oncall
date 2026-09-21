"""Persistence for generation runs and their scheduling policy."""

import uuid
from datetime import date, datetime

from sqlalchemy import case, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.sql.elements import ColumnElement

from oncall.domain.clock import as_utc
from oncall.domain.scheduling.models import (
    ACTIVE_RUN_STATES,
    GenerationRun,
    PolicyChange,
    QueueBacklog,
    RunState,
    SchedulingPolicy,
)
from oncall.infrastructure.sqlalchemy.scheduling_models import ScheduleRun
from oncall.infrastructure.sqlalchemy.scheduling_models import SchedulingPolicy as PolicyRow
from oncall.policy import load_policy


def _count(condition: ColumnElement[bool]) -> ColumnElement[int]:
    """How many rows of an aggregate read satisfy one condition.

    `count(*) FILTER` would say this more directly but is not portable to the
    SQLite databases the fast tests run on.
    """
    return func.coalesce(func.sum(case((condition, 1), else_=0)), 0)


def _to_run(row: ScheduleRun) -> GenerationRun:
    return GenerationRun(
        id=row.id,
        starts_on=row.starts_on,
        ends_on=row.ends_on,
        requested_by_id=row.requested_by_id,
        status=row.status,
        progress=row.progress,
        schedule_id=row.schedule_id,
        error=row.error,
        conflicts=tuple(row.conflicts) if row.conflicts is not None else None,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


class SqlAlchemyGenerationQueue:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def active_run_for(self, starts_on: date, ends_on: date) -> GenerationRun | None:
        row = await self._session.scalar(
            select(ScheduleRun)
            .where(
                ScheduleRun.starts_on == starts_on,
                ScheduleRun.ends_on == ends_on,
                ScheduleRun.status.in_(ACTIVE_RUN_STATES),
            )
            .order_by(ScheduleRun.created_at)
            .limit(1)
        )
        return _to_run(row) if row is not None else None

    async def enqueue(
        self, starts_on: date, ends_on: date, requested_by_id: uuid.UUID
    ) -> GenerationRun:
        row = ScheduleRun(
            starts_on=starts_on,
            ends_on=ends_on,
            requested_by_id=requested_by_id,
            status=RunState.queued,
            progress=0,
        )
        self._session.add(row)
        try:
            await self._session.flush()
        except IntegrityError:
            # A partial unique index allows only one active run per date range.
            await self._session.rollback()
            existing = await self.active_run_for(starts_on, ends_on)
            if existing is None:
                raise
            return existing
        return _to_run(row)

    async def run(self, run_id: uuid.UUID) -> GenerationRun | None:
        row = await self._session.get(ScheduleRun, run_id)
        return _to_run(row) if row is not None else None

    async def runs_of(
        self, requested_by_id: uuid.UUID, statuses: list[str], limit: int
    ) -> list[GenerationRun]:
        rows = await self._session.scalars(
            select(ScheduleRun)
            .where(
                ScheduleRun.requested_by_id == requested_by_id,
                ScheduleRun.status.in_(statuses),
            )
            .order_by(ScheduleRun.created_at.desc())
            .limit(limit)
        )
        return [_to_run(row) for row in rows]

    async def active_runs_before(self, created_at: datetime) -> int:
        return (
            await self._session.scalar(
                select(func.count())
                .select_from(ScheduleRun)
                .where(
                    ScheduleRun.status.in_(ACTIVE_RUN_STATES),
                    ScheduleRun.created_at < created_at,
                )
            )
        ) or 0

    async def recent_completed(self, limit: int) -> list[GenerationRun]:
        rows = await self._session.scalars(
            select(ScheduleRun)
            .where(ScheduleRun.status == RunState.completed)
            .order_by(ScheduleRun.created_at.desc())
            .limit(limit)
        )
        return [_to_run(row) for row in rows.all()]

    async def backlog(self) -> QueueBacklog:
        queued = ScheduleRun.status == RunState.queued
        running = ScheduleRun.status == RunState.running
        row = (
            await self._session.execute(
                select(
                    _count(queued),
                    _count(running),
                    # `created_at` is when the coordinator asked; `updated_at`
                    # on a held run is its last heartbeat. The oldest of each
                    # is the one worth watching, so both are `min`.
                    func.min(case((queued, ScheduleRun.created_at))),
                    func.min(case((running, ScheduleRun.updated_at))),
                ).where(ScheduleRun.status.in_(ACTIVE_RUN_STATES))
            )
        ).one()
        oldest_queued_at, stalest_running_at = row[2], row[3]
        return QueueBacklog(
            queued=row[0],
            running=row[1],
            oldest_queued_at=as_utc(oldest_queued_at) if oldest_queued_at else None,
            stalest_running_at=as_utc(stalest_running_at) if stalest_running_at else None,
        )

    async def abandon_stale_runs(self, untouched_since: datetime, error: str) -> int:
        result = await self._session.execute(
            update(ScheduleRun)
            .where(
                ScheduleRun.status == RunState.running,
                ScheduleRun.updated_at < untouched_since,
            )
            .values(status=RunState.failed, progress=100, error=error)
            # A bulk statement whose only answer is a count, so nothing needs
            # synchronising - and the default would try, by evaluating
            # `updated_at < untouched_since` in Python against every run the
            # session happens to hold. SQLite hands back naive datetimes while
            # the cutoff is UTC-aware, and that comparison raises.
            .execution_options(synchronize_session=False)
        )
        return result.rowcount


def _to_policy(row: PolicyRow) -> SchedulingPolicy:
    return SchedulingPolicy(
        id=row.id,
        rotation_mode=row.rotation_mode,
        fairness_weight=row.fairness_weight,
        continuity_weight=row.continuity_weight,
        preference_weight=row.preference_weight,
        late_shift_anchor=row.late_shift_anchor,
        solve_seconds=row.solve_seconds,
        updated_at=row.updated_at,
    )


class SqlAlchemyPolicyStore:
    """The single policy row, including its established first-read creation."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def current(self) -> SchedulingPolicy:
        return _to_policy(await load_policy(self._session))

    async def change(self, change: PolicyChange) -> SchedulingPolicy:
        row = await load_policy(self._session)
        row.rotation_mode = change.rotation_mode
        if change.fairness_weight is not None:
            row.fairness_weight = change.fairness_weight
        if change.continuity_weight is not None:
            row.continuity_weight = change.continuity_weight
        if change.preference_weight is not None:
            row.preference_weight = change.preference_weight
        if change.late_shift_anchor is not None:
            row.late_shift_anchor = change.late_shift_anchor
        if change.solve_seconds is not None:
            row.solve_seconds = change.solve_seconds
        return _to_policy(row)

    async def written(self) -> SchedulingPolicy:
        """The policy as stored, read back after the unit of work is written."""
        row = await load_policy(self._session)
        await self._session.refresh(row)
        return _to_policy(row)


__all__ = ["SqlAlchemyGenerationQueue", "SqlAlchemyPolicyStore"]
