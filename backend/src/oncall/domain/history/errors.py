from oncall.domain.errors import DomainError
from oncall.domain.history.models import HistoryImportError


class HistoryRejected(DomainError):
    def __init__(self, problems: list[HistoryImportError]) -> None:
        super().__init__("history.rejected")
        self.problems = problems
