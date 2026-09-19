"""The rotation's members, with the periods that say when each one may serve."""

import uuid
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from oncall.domain.ports import TeamDirectory
from oncall.domain.team import AvailabilityPeriod, Member, RolePeriod
from oncall.models import TeamMember, User, UserRole

_WITH_PERIODS = (selectinload(TeamMember.eligibility), selectinload(TeamMember.availability))


def to_member(row: TeamMember) -> Member:
    """Requires `eligibility` and `availability` to be loaded."""
    return Member(
        id=row.id,
        display_name=row.display_name,
        user_id=row.user_id,
        active_from=row.active_from,
        active_until=row.active_until,
        eligibility=tuple(
            RolePeriod(item.role, item.starts_on, item.ends_on) for item in row.eligibility
        ),
        availability=tuple(
            AvailabilityPeriod(item.kind, item.starts_on, item.ends_on) for item in row.availability
        ),
    )


class SqlAlchemyTeamDirectory(TeamDirectory):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def _one(self, *criteria) -> Member | None:
        row = await self._session.scalar(
            select(TeamMember).options(*_WITH_PERIODS).where(*criteria)
        )
        return to_member(row) if row is not None else None

    async def member_for_account(self, user_id: uuid.UUID) -> Member | None:
        return await self._one(TeamMember.user_id == user_id)

    async def member(self, member_id: uuid.UUID) -> Member | None:
        return await self._one(TeamMember.id == member_id)

    async def member_named(self, display_name: str) -> Member | None:
        return await self._one(TeamMember.display_name == display_name)

    async def members(self, member_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, Member]:
        rows = await self._session.scalars(
            select(TeamMember).options(*_WITH_PERIODS).where(TeamMember.id.in_(list(member_ids)))
        )
        return {row.id: to_member(row) for row in rows}

    async def colleagues_of(self, member_id: uuid.UUID) -> list[Member]:
        rows = await self._session.scalars(
            select(TeamMember)
            .options(*_WITH_PERIODS)
            .where(TeamMember.id != member_id)
            .order_by(TeamMember.display_name)
        )
        return [to_member(row) for row in rows]

    async def display_names(self, member_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, str]:
        ids = list(member_ids)
        if not ids:
            return {}
        rows = await self._session.execute(
            select(TeamMember.id, TeamMember.display_name).where(TeamMember.id.in_(ids))
        )
        return dict(rows.tuples().all())

    async def another_active_approver_exists(self, user_id: uuid.UUID) -> bool:
        other = await self._session.scalar(
            select(User.id)
            .where(
                User.id != user_id,
                User.is_active.is_(True),
                User.role.in_((UserRole.coordinator, UserRole.admin)),
            )
            .limit(1)
        )
        return other is not None
