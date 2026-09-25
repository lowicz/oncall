import uuid
from datetime import date

from oncall.domain.errors import DomainError


class TeamMemberNotFound(DomainError):
    def __init__(self, member_id: uuid.UUID) -> None:
        super().__init__("availability.team_member_not_found")
        self.member_id = member_id


class AvailabilityRangeReversed(DomainError):
    def __init__(self, starts_on: date, ends_on: date) -> None:
        super().__init__("availability.range_reversed")
        self.starts_on = starts_on
        self.ends_on = ends_on


class AvailabilityRangeTooLong(DomainError):
    def __init__(self, starts_on: date, ends_on: date) -> None:
        super().__init__("availability.range_too_long")
        self.starts_on = starts_on
        self.ends_on = ends_on


class AvailabilityInThePast(DomainError):
    def __init__(self, ends_on: date) -> None:
        super().__init__("availability.in_the_past")
        self.ends_on = ends_on


class AvailabilityAlreadyExists(DomainError):
    def __init__(self, entry_id: uuid.UUID) -> None:
        super().__init__("availability.already_exists")
        self.entry_id = entry_id


class AvailabilityOverlaps(DomainError):
    def __init__(self, entry_id: uuid.UUID) -> None:
        super().__init__("availability.overlaps")
        self.entry_id = entry_id


class AvailabilityEntryNotFound(DomainError):
    def __init__(self, entry_id: uuid.UUID) -> None:
        super().__init__("availability.entry_not_found")
        self.entry_id = entry_id
