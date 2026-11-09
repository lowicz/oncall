"""When an on-call duty actually runs.

archive/docs/PLAN.md §3: coverage is 19:00-09:00 on Polish working days and round the
clock on Saturdays, Sundays and statutory holidays. A duty is a span of hours,
not a date, and this module is where that span is defined for everyone who has
to answer "until when".
"""

from collections.abc import Container
from datetime import date, datetime, time, timedelta

from oncall.domain.clock import BUSINESS_TIMEZONE
from oncall.domain.vocabulary import AssignmentRole
from oncall.workdays import is_working_day, polish_holidays

#: On-call coverage starts in the evening and ends the next morning.
WORKDAY_START = "19:00"
WORKDAY_END = "09:00"
DAY_OFF_START = "00:00"
DAY_OFF_END = "24:00"
#: The 11-19 shift is a daytime shift, not on-call cover, and its name says so.
LATE_SHIFT_START = "11:00"
LATE_SHIFT_END = "19:00"


def is_day_off(day: date, holidays: Container[date]) -> bool:
    return not is_working_day(day, holidays)


def coverage_window(
    day: date, holidays: set[date], role: AssignmentRole | None = None
) -> tuple[str, str]:
    """The (start, end) clock times of the duty served on `day` in `role`."""
    if role == AssignmentRole.late_shift:
        # Only ever scheduled on working days (archive/docs/PLAN.md §3).
        return LATE_SHIFT_START, LATE_SHIFT_END
    if is_day_off(day, holidays):
        return DAY_OFF_START, DAY_OFF_END
    return WORKDAY_START, WORKDAY_END


def coverage_ended(day: date, role: AssignmentRole, now: datetime) -> bool:
    """Whether the duty served on `day` in `role` is over at `now`: a working
    day's night on-call runs until 09:00 the next morning."""
    starts_at, ends_at = coverage_window(day, polish_holidays(day, day), role)
    hours, minutes = map(int, ends_at.split(":"))
    end = datetime.combine(day, time.min, BUSINESS_TIMEZONE) + timedelta(
        days=1 if ends_at <= starts_at else 0, hours=hours, minutes=minutes
    )
    return now >= end
