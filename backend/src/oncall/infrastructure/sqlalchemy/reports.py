"""Rotation members a fairness report covers."""

from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.reports.models import RosterEntry
from oncall.infrastructure.sqlalchemy.team_models import TeamMember


class SqlAlchemyReportRoster:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def members_active_between(self, starts_on: date, ends_on: date) -> list[RosterEntry]:
        rows = await self._session.execute(
            select(TeamMember.id, TeamMember.display_name)
            .where(
                TeamMember.active_from <= ends_on,
                TeamMember.active_until.is_(None) | (TeamMember.active_until >= starts_on),
            )
            .order_by(TeamMember.display_name)
        )
        return [RosterEntry(*row) for row in rows]
