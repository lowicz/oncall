from datetime import date

import pytest

from oncall.workdays import (
    is_polish_working_day,
    next_working_day,
    polish_holiday_names,
    polish_holidays,
    previous_working_day,
)


def test_polish_holidays_are_clipped_to_requested_range() -> None:
    starts_on = date(2026, 12, 26)
    ends_on = date(2027, 1, 1)

    days = polish_holidays(starts_on, ends_on)

    assert days == {date(2026, 12, 26), date(2027, 1, 1)}


def test_polish_holiday_names_are_clipped_to_requested_range() -> None:
    day = date(2026, 12, 25)

    names = polish_holiday_names(day, day)

    assert set(names) == {day}
    assert names[day]


@pytest.mark.parametrize(
    ("day", "previous", "following"),
    [
        # A Monday reaches back over the weekend, a Friday forward over it.
        (date(2026, 10, 5), date(2026, 10, 2), date(2026, 10, 6)),
        (date(2026, 10, 2), date(2026, 10, 1), date(2026, 10, 5)),
        # A Sunday, from either side of its weekend.
        (date(2026, 10, 4), date(2026, 10, 2), date(2026, 10, 5)),
        # Around the 11 November holiday, a Wednesday.
        (date(2026, 11, 12), date(2026, 11, 10), date(2026, 11, 13)),
        (date(2026, 11, 10), date(2026, 11, 9), date(2026, 11, 12)),
        # Christmas Eve to Boxing Day, then a weekend; New Year across the year.
        (date(2026, 12, 28), date(2026, 12, 23), date(2026, 12, 29)),
        (date(2026, 12, 23), date(2026, 12, 22), date(2026, 12, 28)),
        (date(2027, 1, 4), date(2026, 12, 31), date(2027, 1, 5)),
        # Easter Monday.
        (date(2027, 3, 30), date(2027, 3, 26), date(2027, 3, 31)),
    ],
)
def test_neighbouring_working_days_skip_weekends_and_holidays(
    day: date, previous: date, following: date
) -> None:
    assert previous_working_day(day) == previous
    assert next_working_day(day) == following
    assert is_polish_working_day(previous)
    assert is_polish_working_day(following)
