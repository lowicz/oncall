"""Swap requests a publication has to carry over, announce or cancel."""

import uuid
from collections.abc import Iterable, Sequence

from sqlalchemy import ColumnElement, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from oncall.domain.scheduling.models import ApprovedSwap, PendingSwap
from oncall.domain.vocabulary import SwapStatus
from oncall.infrastructure.sqlalchemy.swap_models import SwapRequest, SwapRequestSlot
from oncall.infrastructure.sqlalchemy.swaps import slots_by_direction
from oncall.infrastructure.sqlalchemy.team_models import TeamMember


def _on(schedule_ids: list[uuid.UUID]) -> ColumnElement[bool]:
    """Swaps with a slot in one of these schedules."""
    return SwapRequest.slots.any(SwapRequestSlot.schedule_id.in_(schedule_ids))


def _one_way(
    rows: Sequence[SwapRequestSlot],
    original_member_id: uuid.UUID,
    names: dict[uuid.UUID, str],
) -> ApprovedSwap:
    """One direction of a swap."""
    return ApprovedSwap(
        schedule_id=rows[0].schedule_id,
        original_member_id=original_member_id,
        original_name=names.get(original_member_id),
        slots=tuple((row.service_date, row.role) for row in rows),
    )


class SqlAlchemyPublicationSwaps:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def _names(self, member_ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
        if not member_ids:
            return {}
        rows = await self._session.execute(
            select(TeamMember.id, TeamMember.display_name).where(TeamMember.id.in_(member_ids))
        )
        return dict(rows.all())

    async def approved_on(self, schedule_ids: Iterable[uuid.UUID]) -> list[ApprovedSwap]:
        swaps = (
            await self._session.scalars(
                select(SwapRequest)
                .options(selectinload(SwapRequest.slots))
                .where(SwapRequest.status == SwapStatus.approved, _on(list(schedule_ids)))
            )
        ).all()
        names = await self._names(
            {
                member_id
                for swap in swaps
                for member_id in (swap.requester_member_id, swap.replacement_member_id)
            }
        )
        approved = []
        for swap in swaps:
            given, returned = slots_by_direction(swap.slots)
            # Each direction has its own original holder: the requester for
            # what was given, the replacement for what came back.
            approved.append(_one_way(given, swap.requester_member_id, names))
            if returned:
                approved.append(_one_way(returned, swap.replacement_member_id, names))
        return approved

    async def pending_on(self, schedule_ids: Iterable[uuid.UUID]) -> list[PendingSwap]:
        swaps = (
            await self._session.scalars(
                select(SwapRequest)
                .options(selectinload(SwapRequest.slots))
                .where(
                    SwapRequest.status.in_(
                        (SwapStatus.pending_replacement, SwapStatus.pending_coordinator)
                    ),
                    _on(list(schedule_ids)),
                )
            )
        ).all()
        pending = []
        for swap in swaps:
            given, returned = slots_by_direction(swap.slots)
            pending.append(
                PendingSwap(
                    id=swap.id,
                    schedule_ids=frozenset(slot.schedule_id for slot in swap.slots),
                    service_date=swap.service_date,
                    role=swap.role,
                    status=swap.status.value,
                    requester_member_id=swap.requester_member_id,
                    replacement_member_id=swap.replacement_member_id,
                    slots=tuple((item.service_date, item.role) for item in given),
                    return_slots=tuple((item.service_date, item.role) for item in returned),
                )
            )
        return pending

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
