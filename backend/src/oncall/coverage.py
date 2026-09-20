"""When an on-call duty actually runs.

archive/docs/PLAN.md §3: coverage is 19:00-09:00 on Polish working days and round the
clock on Saturdays, Sundays and statutory holidays. A duty is a span of hours,
not a date, and this module is where that span is defined for everyone who has
to answer "until when".
"""

from datetime import date

from oncall.domain.vocabulary import AssignmentRole

#: On-call coverage starts in the evening and ends the next morning.
WORKDAY_START = "19:00"
WORKDAY_END = "09:00"
DAY_OFF_START = "00:00"
DAY_OFF_END = "24:00"
#: The 11-19 shift is a daytime shift, not on-call cover, and its name says so.
LATE_SHIFT_START = "11:00"
LATE_SHIFT_END = "19:00"


def is_day_off(day: date, holidays: set[date]) -> bool:
    return day.weekday() >= 5 or day in holidays


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
