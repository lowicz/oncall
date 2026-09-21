"""Duties already served, as fairness points and days the next draft must respect."""

import uuid
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.vocabulary import AssignmentRole
from oncall.fairness import FairnessDuty
from oncall.fairness_data import prior_oncall_days, resolved_duties, solver_history


class SqlAlchemyDutyHistory:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def points(
        self, window_start: date, window_end: date, names_by_id: dict[uuid.UUID, str]
    ) -> tuple[dict[tuple[str, AssignmentRole], float], dict[tuple[str, str], float]]:
        history = await solver_history(self._session, window_start, window_end, names_by_id)
        return history.points, history.lenses

    async def prior_oncall_days(
        self, starts_on: date, names_by_id: dict[uuid.UUID, str]
    ) -> dict[str, set[date]]:
        return await prior_oncall_days(self._session, starts_on, names_by_id)

    async def duties_in_force(self, window_start: date, window_end: date) -> list[FairnessDuty]:
        return await resolved_duties(self._session, window_start, window_end)
