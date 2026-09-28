"""The rotation notices against in-memory ports.

Dates are real ones in the Polish calendar: 5 October 2026 is a Monday,
11 November 2026 (a Wednesday) and 24-26 December 2026 are holidays, and
29 March 2027 is Easter Monday.
"""

from datetime import date, datetime, timedelta

import pytest

from oncall.domain.handover import (
    HandoverPorts,
    NoticeTiming,
    RotationNotice,
    Segment,
    announced_on,
    notices_due,
    remind_of_handover,
)
from oncall.domain.team import Member
from oncall.domain.vocabulary import AssignmentRole
from oncall.workdays import is_polish_working_day
from tests.domain.fakes import FakeRoster, member

PRIMARY = AssignmentRole.primary
SECONDARY = AssignmentRole.secondary
LATE = AssignmentRole.late_shift
HOUR = 9

MONDAY = date(2026, 10, 5)
FRIDAY_BEFORE = date(2026, 10, 2)
SUNDAY = date(2026, 10, 11)


class FakeNotices:
    """Queues each timing of a notice once per first day and person, as the
    outbox does."""

    def __init__(self) -> None:
        self.queued: list[RotationNotice] = []

    async def announce(self, notice: RotationNotice) -> int:
        key = (notice.timing, notice.starts_on, notice.assignee_name)
        if any((item.timing, item.starts_on, item.assignee_name) == key for item in self.queued):
            return 0
        self.queued.append(notice)
        return 1


class RecordingRoster(FakeRoster):
    """Remembers every range the use case read."""

    def __init__(self) -> None:
        super().__init__()
        self.reads: list[tuple[date, date]] = []

    async def duties_in_force(self, starts_on: date, ends_on: date) -> dict:
        self.reads.append((starts_on, ends_on))
        return await super().duties_in_force(starts_on, ends_on)


def hold(
    roster: FakeRoster, role: AssignmentRole, holder: Member | str, first: date, last: date
) -> None:
    """The holder has the role every service day from `first` to `last`:
    11-19 only on Polish working days, as the roster in force has it."""
    day = first
    while day <= last:
        if role is not LATE or is_polish_working_day(day):
            roster.assign(day, role, holder)
        day += timedelta(days=1)


def week(monday: date) -> tuple[date, date]:
    return monday, monday + timedelta(days=6)


def ahead(starts_on: date, name: str, *segments: Segment) -> RotationNotice:
    return RotationNotice(NoticeTiming.ahead, starts_on, name, segments)


def same_day(starts_on: date, name: str, *segments: Segment) -> RotationNotice:
    return RotationNotice(NoticeTiming.same_day, starts_on, name, segments)


def at(day: date, hour: int = HOUR) -> datetime:
    return datetime(day.year, day.month, day.day, hour)


def weekly_primary(first_week: str = "Marek", second_week: str = "Anna") -> FakeRoster:
    roster = FakeRoster()
    hold(roster, PRIMARY, first_week, *week(MONDAY - timedelta(days=7)))
    hold(roster, PRIMARY, second_week, *week(MONDAY))
    return roster


@pytest.mark.parametrize(
    ("today", "days"),
    [
        # A Friday tells about the weekend and the Monday after it.
        (FRIDAY_BEFORE, [FRIDAY_BEFORE + timedelta(days=offset) for offset in range(4)]),
        # A weekend day or a holiday tells only about itself.
        (date(2026, 10, 3), [date(2026, 10, 3)]),
        (date(2026, 11, 11), [date(2026, 11, 11)]),
        # The day before a midweek holiday reaches over it.
        (date(2026, 11, 10), [date(2026, 11, 10), date(2026, 11, 11), date(2026, 11, 12)]),
        # Christmas Eve is a holiday: the Wednesday before reaches to Monday.
        (date(2026, 12, 23), [date(2026, 12, 23) + timedelta(days=n) for n in range(6)]),
    ],
)
def test_the_days_told_about_reach_the_next_working_day(today: date, days: list[date]) -> None:
    assert announced_on(today) == days


async def test_nobody_is_told_before_the_reminder_hour() -> None:
    notices = FakeNotices()
    ports = HandoverPorts(weekly_primary(), notices)

    assert await remind_of_handover(at(FRIDAY_BEFORE, HOUR - 1), HOUR, ports) == 0
    assert await remind_of_handover(at(MONDAY, HOUR - 1), HOUR, ports) == 0
    assert notices.queued == []


async def test_a_weekly_rotation_is_told_the_working_day_before_and_on_its_first_day() -> None:
    notices = FakeNotices()
    ports = HandoverPorts(weekly_primary(), notices)
    segment = Segment(PRIMARY, MONDAY, SUNDAY)

    assert await remind_of_handover(at(FRIDAY_BEFORE), HOUR, ports) == 1
    assert await remind_of_handover(at(FRIDAY_BEFORE, 17), HOUR, ports) == 0
    assert await remind_of_handover(at(MONDAY), HOUR, ports) == 1

    # Only the person taking the role over; Marek, handing it over, is not told.
    assert notices.queued == [
        ahead(MONDAY, "Anna", segment),
        same_day(MONDAY, "Anna", segment),
    ]


async def test_the_days_inside_a_segment_bring_nothing() -> None:
    roster = weekly_primary()
    for offset in (1, 2):
        assert await notices_due(FRIDAY_BEFORE + timedelta(days=offset), roster) == []
    for offset in range(1, 7):
        assert await notices_due(MONDAY + timedelta(days=offset), roster) == []


@pytest.mark.parametrize(
    ("starts_on", "told_ahead_on"),
    [
        # After the 11 November holiday: told on the Tuesday before it.
        (date(2026, 11, 12), date(2026, 11, 10)),
        # After Christmas: told on the Wednesday before Christmas Eve.
        (date(2026, 12, 28), date(2026, 12, 23)),
        # After Easter Monday: told on the Friday before Easter.
        (date(2027, 3, 30), date(2027, 3, 26)),
        # A weekend start: told on the Friday before it.
        (date(2026, 10, 3), FRIDAY_BEFORE),
    ],
)
async def test_the_notice_ahead_goes_out_on_the_previous_polish_working_day(
    starts_on: date, told_ahead_on: date
) -> None:
    roster = FakeRoster()
    hold(roster, PRIMARY, "Marek", starts_on - timedelta(days=10), starts_on - timedelta(days=1))
    hold(roster, PRIMARY, "Anna", starts_on, starts_on + timedelta(days=6))
    segment = Segment(PRIMARY, starts_on, starts_on + timedelta(days=6))

    assert await notices_due(told_ahead_on, roster) == [ahead(starts_on, "Anna", segment)]
    assert await notices_due(starts_on, roster) == [same_day(starts_on, "Anna", segment)]
    for day in range(1, (starts_on - told_ahead_on).days):
        assert await notices_due(told_ahead_on + timedelta(days=day), roster) == []


async def test_roles_one_person_starts_together_go_in_one_notice() -> None:
    """SECONDARY for the week and 11-19 on its working days, both from Monday:
    one notice, each role with the last day of its own segment."""
    roster = FakeRoster()
    hold(roster, SECONDARY, "Marek", *week(MONDAY - timedelta(days=7)))
    hold(roster, LATE, "Marek", *week(MONDAY - timedelta(days=7)))
    hold(roster, SECONDARY, "Ola", *week(MONDAY))
    hold(roster, LATE, "Ola", *week(MONDAY))
    segments = (Segment(SECONDARY, MONDAY, SUNDAY), Segment(LATE, MONDAY, date(2026, 10, 9)))

    assert await notices_due(FRIDAY_BEFORE, roster) == [ahead(MONDAY, "Ola", *segments)]
    assert await notices_due(MONDAY, roster) == [same_day(MONDAY, "Ola", *segments)]


async def test_moving_from_primary_to_secondary_starts_a_new_segment() -> None:
    roster = weekly_primary(first_week="Anna", second_week="Marek")
    hold(roster, SECONDARY, "Marek", *week(MONDAY - timedelta(days=7)))
    hold(roster, SECONDARY, "Anna", *week(MONDAY))

    assert await notices_due(FRIDAY_BEFORE, roster) == [
        ahead(MONDAY, "Anna", Segment(SECONDARY, MONDAY, SUNDAY)),
        ahead(MONDAY, "Marek", Segment(PRIMARY, MONDAY, SUNDAY)),
    ]


async def test_different_first_days_are_different_notices() -> None:
    """On a Friday one person can be told about a Saturday and a Monday."""
    roster = FakeRoster()
    saturday = date(2026, 10, 3)
    hold(roster, PRIMARY, "Marek", MONDAY - timedelta(days=7), FRIDAY_BEFORE)
    hold(roster, PRIMARY, "Anna", saturday, SUNDAY)
    hold(roster, LATE, "Marek", MONDAY - timedelta(days=7), FRIDAY_BEFORE)
    hold(roster, LATE, "Anna", MONDAY, MONDAY)

    assert await notices_due(FRIDAY_BEFORE, roster) == [
        ahead(saturday, "Anna", Segment(PRIMARY, saturday, SUNDAY)),
        ahead(MONDAY, "Anna", Segment(LATE, MONDAY, MONDAY)),
    ]


async def test_11_19_continues_across_a_weekend_and_a_holiday() -> None:
    """11-19 has no shift on the days between, so they do not break it."""
    roster = FakeRoster()
    hold(roster, LATE, "Marek", date(2026, 10, 26), date(2026, 10, 30))
    hold(roster, LATE, "Ola", date(2026, 11, 2), date(2026, 11, 13))
    segment = Segment(LATE, date(2026, 11, 2), date(2026, 11, 13))

    assert await notices_due(date(2026, 10, 30), roster) == [
        ahead(date(2026, 11, 2), "Ola", segment)
    ]
    for day in (date(2026, 11, 6), date(2026, 11, 9), date(2026, 11, 10), date(2026, 11, 12)):
        assert await notices_due(day, roster) == []


async def test_11_19_after_a_holiday_is_compared_with_the_working_day_before_it() -> None:
    roster = FakeRoster()
    hold(roster, LATE, "Ola", date(2026, 11, 2), date(2026, 11, 10))
    hold(roster, LATE, "Marek", date(2026, 11, 12), date(2026, 11, 13))
    segment = Segment(LATE, date(2026, 11, 12), date(2026, 11, 13))

    assert await notices_due(date(2026, 11, 10), roster) == [
        ahead(date(2026, 11, 12), "Marek", segment)
    ]
    assert await notices_due(date(2026, 11, 12), roster) == [
        same_day(date(2026, 11, 12), "Marek", segment)
    ]


async def test_a_segment_longer_than_one_read_ends_where_the_holder_changes() -> None:
    roster = RecordingRoster()
    hold(roster, PRIMARY, "Anna", MONDAY, date(2026, 11, 30))
    hold(roster, PRIMARY, "Marek", date(2026, 12, 1), date(2026, 12, 7))

    assert await notices_due(MONDAY, roster) == [
        same_day(MONDAY, "Anna", Segment(PRIMARY, MONDAY, date(2026, 11, 30)))
    ]
    assert roster.reads == [
        (FRIDAY_BEFORE, date(2026, 11, 6)),
        (date(2026, 11, 7), date(2026, 12, 12)),
    ]


async def test_a_segment_ends_where_the_roster_in_force_ends() -> None:
    roster = FakeRoster()
    hold(roster, PRIMARY, "Anna", MONDAY, date(2026, 10, 8))

    assert await notices_due(MONDAY, roster) == [
        same_day(MONDAY, "Anna", Segment(PRIMARY, MONDAY, date(2026, 10, 8)))
    ]


async def test_the_holder_is_the_member_not_the_label() -> None:
    """Two members of one name are two people; a slot's label alone is the
    identity only where the slot names no member."""
    first, second = member("Anna Kowalska"), member("Anna Kowalska")
    roster = FakeRoster()
    hold(roster, PRIMARY, first, *week(MONDAY - timedelta(days=7)))
    hold(roster, PRIMARY, second, *week(MONDAY))

    assert await notices_due(MONDAY, roster) == [
        same_day(MONDAY, "Anna Kowalska", Segment(PRIMARY, MONDAY, SUNDAY))
    ]


async def test_notices_are_ordered_by_first_day_and_then_by_name() -> None:
    roster = FakeRoster()
    for role in AssignmentRole:
        hold(roster, role, "Piotr", MONDAY - timedelta(days=7), FRIDAY_BEFORE)
    hold(roster, PRIMARY, "Ola", date(2026, 10, 3), SUNDAY)
    hold(roster, SECONDARY, "Marek", date(2026, 10, 3), SUNDAY)
    hold(roster, LATE, "Anna", MONDAY, MONDAY)

    due = await notices_due(FRIDAY_BEFORE, roster)

    assert [(notice.starts_on, notice.assignee_name) for notice in due] == [
        (date(2026, 10, 3), "Marek"),
        (date(2026, 10, 3), "Ola"),
        (MONDAY, "Anna"),
    ]
