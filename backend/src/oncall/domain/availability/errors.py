from oncall.domain.errors import DomainError


class TeamMemberNotFound(DomainError):
    def __init__(self) -> None:
        super().__init__("availability.team_member_not_found")


class AvailabilityRangeReversed(DomainError):
    def __init__(self) -> None:
        super().__init__("availability.range_reversed")


class AvailabilityRangeTooLong(DomainError):
    def __init__(self) -> None:
        super().__init__("availability.range_too_long")


class AvailabilityInThePast(DomainError):
    def __init__(self) -> None:
        super().__init__("availability.in_the_past")


class AvailabilityAlreadyExists(DomainError):
    def __init__(self) -> None:
        super().__init__("availability.already_exists")


class AvailabilityOverlaps(DomainError):
    def __init__(self) -> None:
        super().__init__("availability.overlaps")


class AvailabilityEntryNotFound(DomainError):
    def __init__(self) -> None:
        super().__init__("availability.entry_not_found")
