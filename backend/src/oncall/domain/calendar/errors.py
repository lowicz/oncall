import uuid

from oncall.domain.errors import DomainError


class CalendarRangeError(DomainError):
    """A requested date range the calendar cannot serve."""


class RangeEndsBeforeStart(CalendarRangeError):
    def __init__(self) -> None:
        super().__init__("calendar.range_ends_before_start")


class EventRangeTooLong(CalendarRangeError):
    def __init__(self) -> None:
        super().__init__("calendar.event_range_too_long")


class CalendarRangeInvalid(CalendarRangeError):
    def __init__(self) -> None:
        super().__init__("calendar.range_invalid")


class OutsideShareRange(CalendarRangeError):
    def __init__(self) -> None:
        super().__init__("calendar.outside_share_range")


class DashboardRangeReversed(CalendarRangeError):
    def __init__(self) -> None:
        super().__init__("calendar.dashboard_range_reversed")


class CalendarEventNotFound(DomainError):
    def __init__(self, event_id: uuid.UUID) -> None:
        super().__init__("calendar.event_not_found")
        self.event_id = event_id
