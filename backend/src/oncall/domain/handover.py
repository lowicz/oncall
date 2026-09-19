"""The daily reminder to hand the on-call number over."""

import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Protocol

from oncall.domain.ports import PublishedRoster
from oncall.domain.vocabulary import AssignmentRole


class HandoverNotices(Protocol):
    async def remind(
        self,
        *,
        service_date: date,
        schedule_id: uuid.UUID,
        outgoing_name: str,
        incoming_name: str,
    ) -> int:
        """Remind both people, at most once per day and schedule; answers with
        how many reminders were queued now."""
        ...


@dataclass(frozen=True)
class HandoverPorts:
    roster: PublishedRoster
    notices: HandoverNotices


async def _primary_on(roster: PublishedRoster, day: date) -> str | None:
    duty = (await roster.duties_in_force(day, day)).get((day, AssignmentRole.primary))
    return duty.assignee_name if duty is not None else None


async def remind_of_handover(now_local: datetime, reminder_hour: int, ports: HandoverPorts) -> int:
    """Queue today's PRIMARY handover reminders once the reminder hour has come
    and PRIMARY changes hands today."""
    today = now_local.date()
    if now_local.hour < reminder_hour:
        return 0
    duty = (await ports.roster.duties_in_force(today, today)).get((today, AssignmentRole.primary))
    if duty is None:
        return 0
    incoming = await _primary_on(ports.roster, today)
    outgoing = await _primary_on(ports.roster, today - timedelta(days=1))
    if not incoming or not outgoing or incoming == outgoing:
        return 0
    return await ports.notices.remind(
        service_date=today,
        schedule_id=duty.schedule_id,
        outgoing_name=outgoing,
        incoming_name=incoming,
    )
