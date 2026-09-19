import uuid

from oncall.domain.errors import DomainError


class CalendarRangeError(DomainError):
    """A requested date range the calendar cannot serve."""


class RangeEndsBeforeStart(CalendarRangeError):
    def __init__(self) -> None:
        super().__init__("Data końcowa nie może poprzedzać początkowej")


class EventRangeTooLong(CalendarRangeError):
    def __init__(self) -> None:
        super().__init__("Zakres wydarzeń musi obejmować od 1 do 90 dni")


class CalendarRangeInvalid(CalendarRangeError):
    def __init__(self) -> None:
        super().__init__("Zakres kalendarza musi obejmować od 1 do 90 dni")


class OutsideShareRange(CalendarRangeError):
    def __init__(self) -> None:
        super().__init__("Żądany zakres jest poza zakresem dat linku")


class DashboardRangeReversed(CalendarRangeError):
    def __init__(self) -> None:
        super().__init__("Data ends_on nie może być wcześniejsza niż starts_on")


class CalendarEventNotFound(DomainError):
    def __init__(self, event_id: uuid.UUID) -> None:
        super().__init__("Nie znaleziono wydarzenia")
        self.event_id = event_id
