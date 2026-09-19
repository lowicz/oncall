import uuid
from datetime import date

from oncall.domain.errors import DomainError


class TeamMemberNotFound(DomainError):
    def __init__(self, member_id: uuid.UUID) -> None:
        super().__init__("Nie znaleziono członka zespołu")
        self.member_id = member_id


class AvailabilityRangeReversed(DomainError):
    def __init__(self, starts_on: date, ends_on: date) -> None:
        super().__init__("Data końcowa nie może poprzedzać początkowej")
        self.starts_on = starts_on
        self.ends_on = ends_on


class AvailabilityRangeTooLong(DomainError):
    def __init__(self, starts_on: date, ends_on: date) -> None:
        super().__init__("Jeden wpis dostępności może obejmować maksymalnie 366 dni")
        self.starts_on = starts_on
        self.ends_on = ends_on


class AvailabilityInThePast(DomainError):
    def __init__(self, ends_on: date) -> None:
        super().__init__("Nie można dodać dostępności w całości w przeszłości")
        self.ends_on = ends_on


class AvailabilityAlreadyExists(DomainError):
    def __init__(self, entry_id: uuid.UUID) -> None:
        super().__init__("Taki wpis dostępności już istnieje")
        self.entry_id = entry_id


class AvailabilityOverlaps(DomainError):
    def __init__(self, entry_id: uuid.UUID) -> None:
        super().__init__("Zakres nakłada się na istniejący wpis dostępności")
        self.entry_id = entry_id


class AvailabilityEntryNotFound(DomainError):
    def __init__(self, entry_id: uuid.UUID) -> None:
        super().__init__("Nie znaleziono wpisu")
        self.entry_id = entry_id
