"""The handover reminder against in-memory ports."""

from datetime import date, datetime, timedelta

from oncall.domain.handover import HandoverPorts, remind_of_handover
from oncall.domain.vocabulary import AssignmentRole
from tests.domain.fakes import FakeRoster

TODAY = date(2030, 3, 5)
HOUR = 15


class FakeNotices:
    def __init__(self) -> None:
        self.reminded: list[dict] = []

    async def remind(self, **kwargs) -> int:
        self.reminded.append(kwargs)
        return 2


def _ports(yesterday: str, today: str) -> tuple[HandoverPorts, FakeRoster, FakeNotices]:
    roster, notices = FakeRoster(), FakeNotices()
    roster.assign(TODAY - timedelta(days=1), AssignmentRole.primary, yesterday)
    roster.assign(TODAY, AssignmentRole.primary, today)
    return HandoverPorts(roster, notices), roster, notices


async def test_the_number_changing_hands_is_reminded_after_the_hour() -> None:
    ports, roster, notices = _ports("Marek", "Anna")

    assert await remind_of_handover(datetime(2030, 3, 5, HOUR - 1), HOUR, ports) == 0
    assert await remind_of_handover(datetime(2030, 3, 5, HOUR), HOUR, ports) == 2
    assert notices.reminded == [
        {
            "service_date": TODAY,
            "schedule_id": roster.schedule_ref.id,
            "outgoing_name": "Marek",
            "incoming_name": "Anna",
        }
    ]


async def test_nobody_is_reminded_when_primary_stays_or_is_unknown() -> None:
    same, _, same_notices = _ports("Anna", "Anna")
    assert await remind_of_handover(datetime(2030, 3, 5, HOUR), HOUR, same) == 0

    gap, roster, gap_notices = _ports("Marek", "Anna")
    del roster.schedule_ref.slots[(TODAY - timedelta(days=1), AssignmentRole.primary)]
    assert await remind_of_handover(datetime(2030, 3, 5, HOUR), HOUR, gap) == 0
    assert same_notices.reminded == gap_notices.reminded == []
