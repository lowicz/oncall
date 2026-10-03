from oncall.domain.errors import DomainError


class InvalidMonth(DomainError):
    def __init__(self) -> None:
        super().__init__("reports.invalid_month")
