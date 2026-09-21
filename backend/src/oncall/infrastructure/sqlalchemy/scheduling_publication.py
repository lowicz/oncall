"""Swap requests a publication has to carry over, announce or cancel."""

import uuid
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from oncall.domain.scheduling.models import ApprovedSwap, PendingSwap
from oncall.domain.scheduling.ports import PublicationSwaps
from oncall.domain.vocabulary import SwapStatus
from oncall.infrastructure.sqlalchemy.swap_models import SwapRequest
from oncall.infrastructure.sqlalchemy.team_models import TeamMember


class SqlAlchemyPublicationSwaps(PublicationSwaps):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def _names(self, member_ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
        if not member_ids:
            return {}
        rows = await self._session.execute(
            select(TeamMember.id, TeamMember.display_name).where(TeamMember.id.in_(member_ids))
        )
        return dict(rows.tuples().all())

    async def approved_on(self, schedule_ids: Iterable[uuid.UUID]) -> list[ApprovedSwap]:
        swaps = (
            await self._session.scalars(
                select(SwapRequest)
                .options(selectinload(SwapRequest.slots))
                .where(SwapRequest.schedule_id.in_(list(schedule_ids)))
            )
        ).all()
        approved = [swap for swap in swaps if swap.status == SwapStatus.approved]
        names = await self._names(
            {
                member_id
                for swap in approved
                for member_id in (swap.requester_member_id, swap.replacement_member_id)
            }
        )
        return [
            ApprovedSwap(
                schedule_id=swap.schedule_id,
                requester_name=names.get(swap.requester_member_id),
                replacement_name=names.get(swap.replacement_member_id),
                slots=tuple((item.service_date, item.role) for item in (swap.slots or [swap])),
            )
            for swap in approved
        ]

    async def pending_on(self, schedule_ids: Iterable[uuid.UUID]) -> list[PendingSwap]:
        swaps = (
            await self._session.scalars(
                select(SwapRequest)
                .options(selectinload(SwapRequest.slots))
                .where(
                    SwapRequest.schedule_id.in_(list(schedule_ids)),
                    SwapRequest.status.in_(
                        (SwapStatus.pending_replacement, SwapStatus.pending_coordinator)
                    ),
                )
            )
        ).all()
        return [
            PendingSwap(
                id=swap.id,
                schedule_id=swap.schedule_id,
                service_date=swap.service_date,
                role=swap.role,
                status=swap.status.value,
                requester_member_id=swap.requester_member_id,
                replacement_member_id=swap.replacement_member_id,
                slot_dates=tuple(item.service_date for item in swap.slots),
            )
            for swap in swaps
        ]

    async def cancel_for_publication(self, swap_ids: Iterable[uuid.UUID]) -> list[uuid.UUID]:
        swaps = (
            await self._session.scalars(
                select(SwapRequest).where(SwapRequest.id.in_(list(swap_ids))).with_for_update()
            )
        ).all()
        for swap in swaps:
            swap.status = SwapStatus.cancelled
            swap.decision_note = "Grafik zastąpiony nową publikacją"
        return [swap.id for swap in swaps]
