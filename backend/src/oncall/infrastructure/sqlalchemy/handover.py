"""Ports for the worker job that reminds a pair about tomorrow's handover."""

import uuid
from datetime import date

from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.handover import HandoverNotices, HandoverPorts
from oncall.infrastructure.sqlalchemy.roster import SqlAlchemyPublishedRoster
from oncall.notifications.triggers import enqueue_handover_reminders


class SqlAlchemyHandoverNotices(HandoverNotices):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def remind(
        self,
        *,
        service_date: date,
        schedule_id: uuid.UUID,
        outgoing_name: str,
        incoming_name: str,
    ) -> int:
        return await enqueue_handover_reminders(
            self._session,
            service_date=service_date,
            schedule_id=schedule_id,
            outgoing_name=outgoing_name,
            incoming_name=incoming_name,
        )


def handover_ports(session: AsyncSession) -> HandoverPorts:
    return HandoverPorts(
        roster=SqlAlchemyPublishedRoster(session), notices=SqlAlchemyHandoverNotices(session)
    )
