import uuid
from datetime import date

from oncall.domain.errors import DomainError
from oncall.domain.vocabulary import AssignmentRole
from oncall.rules import RuleViolation


class LateShiftOnlyOnWorkingDays(DomainError):
    def __init__(self, service_date: date) -> None:
        super().__init__("Zmiana 11–19 jest dostępna tylko w dni robocze")
        self.service_date = service_date


class PublishedScheduleNotFound(DomainError):
    def __init__(self, schedule_id: uuid.UUID | None) -> None:
        super().__init__("Nie znaleziono opublikowanego grafiku")
        self.schedule_id = schedule_id


class PersonNotFound(DomainError):
    def __init__(self, member_id: uuid.UUID) -> None:
        super().__init__("Nie znaleziono osoby")
        self.member_id = member_id


class PersonNotEligible(DomainError):
    def __init__(self, member_id: uuid.UUID, role: AssignmentRole, service_date: date) -> None:
        super().__init__("Osoba nie ma eligibility")
        self.member_id = member_id
        self.role = role
        self.service_date = service_date


class PersonUnavailable(DomainError):
    def __init__(self, member_id: uuid.UUID, service_date: date) -> None:
        super().__init__("Osoba jest niedostępna")
        self.member_id = member_id
        self.service_date = service_date


class PersonAlreadyHoldsRole(DomainError):
    def __init__(self, member_id: uuid.UUID, service_date: date) -> None:
        super().__init__("Ta osoba już pełni tę rolę tego dnia")
        self.member_id = member_id
        self.service_date = service_date


class PersonAlreadyOnCall(DomainError):
    def __init__(self, member_id: uuid.UUID, service_date: date) -> None:
        super().__init__("Osoba ma już drugi on-call tego dnia")
        self.member_id = member_id
        self.service_date = service_date


class RosterChangedMeanwhile(DomainError):
    """The schedule is no longer at the version the coordinator was looking at."""

    def __init__(self, schedule_id: uuid.UUID, expected_version: int) -> None:
        super().__init__("Grafik zmienił się; odśwież kalendarz")
        self.schedule_id = schedule_id
        self.expected_version = expected_version


class RepeatedSlotInBatch(DomainError):
    def __init__(self) -> None:
        super().__init__("Lista zawiera powtórzony slot")


class EmptyBatch(DomainError):
    def __init__(self) -> None:
        super().__init__("Korekta wsadowa musi obejmować co najmniej jeden slot")


class ScheduleSlotNotFound(DomainError):
    def __init__(self, service_date: date, role: AssignmentRole) -> None:
        super().__init__("Nie znaleziono slotu grafiku")
        self.service_date = service_date
        self.role = role


class HistoricalCorrectionNeedsReason(DomainError):
    def __init__(self, service_date: date) -> None:
        super().__init__("Korekta historyczna wymaga powodu (minimum 10 znaków)")
        self.service_date = service_date


class BatchCorrectionNeedsReason(DomainError):
    def __init__(self) -> None:
        super().__init__("Korekta wsadowa wymaga powodu (minimum 10 znaków)")


#: What the coordinator does next when a correction would break a hard rule.
ACKNOWLEDGE_NEXT_STEP = (
    "Wybierz inną osobę albo potwierdź świadome naruszenie reguł twardych;"
    " trafi ono do dziennika audytu."
)


class RuleViolationsNotAcknowledged(DomainError):
    """A correction that breaks a hard rule goes through only once the
    coordinator has seen the violations and explicitly acknowledged them."""

    reason = "RULE_VIOLATIONS"

    def __init__(self, violations: list[RuleViolation]) -> None:
        super().__init__("Korekta złamie reguły twarde grafiku; potwierdź świadome naruszenie")
        self.violations = violations
        self.next_step = ACKNOWLEDGE_NEXT_STEP
