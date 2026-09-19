from datetime import date

from oncall.workdays import polish_holiday_names, polish_holidays


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
