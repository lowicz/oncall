"""Recorded changes scheduling compares a draft against, with the spans they touch."""

import uuid
from collections import defaultdict
from collections.abc import Iterable
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.scheduling.models import ChangeRecord
from oncall.domain.scheduling.ports import ChangeLog
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.availability_model import Availability
from oncall.infrastructure.sqlalchemy.swap_models import SwapRequestSlot
from oncall.infrastructure.sqlalchemy.team_models import Eligibility


def _to_record(row: AuditEvent) -> ChangeRecord:
    return ChangeRecord(
        action=row.action, entity_id=row.entity_id, summary=row.summary, details=row.details
    )


class SqlAlchemyChangeLog(ChangeLog):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def changes_since(self, moment: datetime, actions: Iterable[str]) -> list[ChangeRecord]:
        rows = await self._session.scalars(
            select(AuditEvent).where(
                AuditEvent.occurred_at > moment, AuditEvent.action.in_(list(actions))
            )
        )
        return [_to_record(row) for row in rows.all()]

    async def schedule_changes(
        self, schedule_ids: Iterable[uuid.UUID], actions: Iterable[str]
    ) -> list[ChangeRecord]:
        rows = await self._session.scalars(
            select(AuditEvent)
            .where(
                AuditEvent.entity_type == "schedule",
                AuditEvent.entity_id.in_([str(item) for item in schedule_ids]),
                AuditEvent.action.in_(list(actions)),
            )
            .order_by(AuditEvent.occurred_at)
        )
        return [_to_record(row) for row in rows.all()]

    async def availability_spans(
        self, entry_ids: Iterable[uuid.UUID]
    ) -> dict[uuid.UUID, tuple[date, date]]:
        rows = await self._session.scalars(
            select(Availability).where(Availability.id.in_(list(entry_ids)))
        )
        return {row.id: (row.starts_on, row.ends_on) for row in rows}

    async def eligibility_spans(
        self, period_ids: Iterable[uuid.UUID]
    ) -> dict[uuid.UUID, tuple[date, date | None]]:
        rows = await self._session.scalars(
            select(Eligibility).where(Eligibility.id.in_(list(period_ids)))
        )
        return {row.id: (row.starts_on, row.ends_on) for row in rows}

    async def swap_slot_days(self, swap_ids: Iterable[uuid.UUID]) -> dict[uuid.UUID, list[date]]:
        slot_days: dict[uuid.UUID, list[date]] = defaultdict(list)
        for slot in await self._session.scalars(
            select(SwapRequestSlot).where(SwapRequestSlot.swap_request_id.in_(list(swap_ids)))
        ):
            slot_days[slot.swap_request_id].append(slot.service_date)
        return slot_days
