"""The Polish working-day calendar, in one place.

A working day is Monday to Friday that is not a Polish statutory holiday. The
11-19 shift exists only on those days, so the solver, every read path and the
CSV import have to answer this question identically. The `holidays` package is
the single source of statutory holidays for every path.
"""

from datetime import date
from functools import lru_cache

import holidays as country_holidays


@lru_cache(maxsize=32)
def _polish_holiday_years(first_year: int, last_year: int) -> tuple[tuple[date, str], ...]:
    """Build the immutable statutory calendar once for a year span."""
    return tuple(
        country_holidays.country_holidays("PL", years=range(first_year, last_year + 1)).items()
    )


def polish_holiday_names(starts_on: date, ends_on: date) -> dict[date, str]:
    """Named Polish statutory holidays clipped to the requested range."""
    names = _polish_holiday_years(starts_on.year, ends_on.year)
    return {day: name for day, name in names if starts_on <= day <= ends_on}


def polish_holidays(starts_on: date, ends_on: date) -> set[date]:
    """The same calendar as a set, for the callers that only ask yes or no."""
    return set(polish_holiday_names(starts_on, ends_on))


def is_working_day(day: date, holidays: set[date]) -> bool:
    return day.weekday() < 5 and day not in holidays
