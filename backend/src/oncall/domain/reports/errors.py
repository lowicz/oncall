from oncall.domain.errors import DomainError


class InvalidMonth(DomainError):
    def __init__(self, month: str) -> None:
        super().__init__("Miesiąc musi mieć format RRRR-MM")
        self.month = month
