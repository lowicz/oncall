"""Ports for the worker job that tells a person about the roles they start."""

from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.handover import HandoverPorts, RotationNotice
from oncall.infrastructure.sqlalchemy.roster import SqlAlchemyPublishedRoster
from oncall.notifications.triggers import enqueue_rotation_notice


class SqlAlchemyHandoverNotices:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def announce(self, notice: RotationNotice) -> int:
        return await enqueue_rotation_notice(self._session, notice)


def handover_ports(session: AsyncSession) -> HandoverPorts:
    return HandoverPorts(
        roster=SqlAlchemyPublishedRoster(session), notices=SqlAlchemyHandoverNotices(session)
    )
