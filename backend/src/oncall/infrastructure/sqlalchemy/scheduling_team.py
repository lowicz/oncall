"""Rotation members as scheduling sees them: who exists, who is active, who is eligible."""

import uuid
from collections.abc import Iterable
from datetime import date

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from oncall.domain.scheduling.ports import SchedulingTeam
from oncall.domain.team import Member
from oncall.domain.vocabulary import AssignmentRole, AvailabilityKind
from oncall.fairness import EligibilityPeriod, FairnessMemberInput
from oncall.infrastructure.sqlalchemy.team import to_member
from oncall.models import TeamMember


class SqlAlchemySchedulingTeam(SchedulingTeam):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def everyone(self) -> list[Member]:
        rows = (
            (
                await self._session.scalars(
                    select(TeamMember).options(
                        selectinload(TeamMember.eligibility),
                        selectinload(TeamMember.availability),
                    )
                )
            )
            .unique()
            .all()
        )
        return [to_member(row) for row in rows]

    async def active_between(self, starts_on: date, ends_on: date) -> list[FairnessMemberInput]:
        rows = (
            (
                await self._session.scalars(
                    select(TeamMember)
                    .options(
                        selectinload(TeamMember.eligibility),
                        selectinload(TeamMember.availability),
                    )
                    .where(
                        TeamMember.active_from <= ends_on,
                        TeamMember.active_until.is_(None) | (TeamMember.active_until >= starts_on),
                    )
                    .order_by(TeamMember.display_name)
                )
            )
            .unique()
            .all()
        )
        return [
            FairnessMemberInput(
                id=member.id,
                display_name=member.display_name,
                active_from=member.active_from,
                active_until=member.active_until,
                eligibility={
                    role: [
                        EligibilityPeriod(item.starts_on, item.ends_on)
                        for item in member.eligibility
                        if item.role == role
                    ]
                    for role in AssignmentRole
                },
                unavailable_periods=[
                    (entry.starts_on, entry.ends_on)
                    for entry in member.availability
                    if entry.kind == AvailabilityKind.unavailable
                ],
            )
            for member in rows
        ]

    async def ids_by_name(self, names: Iterable[str]) -> dict[str, uuid.UUID]:
        rows = await self._session.scalars(
            select(TeamMember).where(TeamMember.display_name.in_(list(names)))
        )
        return {item.display_name: item.id for item in rows}
