"""Ports for the worker job that tells coordinators who is on duty today."""

from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.digest import DigestPorts, DutyDigest
from oncall.infrastructure.sqlalchemy.roster import SqlAlchemyPublishedRoster
from oncall.notifications.triggers import enqueue_duty_digest


class SqlAlchemyDigestRecipients:
    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def send(self, digest: DutyDigest) -> int:
        return await enqueue_duty_digest(self._session, digest)


def digest_ports(session: AsyncSession) -> DigestPorts:
    return DigestPorts(
        roster=SqlAlchemyPublishedRoster(session), recipients=SqlAlchemyDigestRecipients(session)
    )
