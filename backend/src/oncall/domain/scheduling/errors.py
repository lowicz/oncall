import uuid
from datetime import date

from oncall.domain.errors import DomainError
from oncall.domain.roster import Slot
from oncall.domain.scheduling.models import (
    PendingSwapNotice,
    ProtectedChange,
    UnavailabilityConflict,
)
from oncall.rules import RuleViolation


class ScheduleNotFound(DomainError):
    def __init__(self, schedule_id: uuid.UUID) -> None:
        super().__init__("Nie znaleziono grafiku")
        self.schedule_id = schedule_id


class GenerationRunNotFound(DomainError):
    def __init__(self, run_id: uuid.UUID) -> None:
        super().__init__("Nie znaleziono zadania generatora")
        self.run_id = run_id


class PolicyWithoutWeight(DomainError):
    def __init__(self) -> None:
        super().__init__("Co najmniej jedna waga generatora musi być większa od zera")


class GenerationFailed(DomainError):
    """The solver could not fill the horizon; nothing was stored."""

    def __init__(self, message: str, reason: str | None, conflicts: tuple[str, ...]) -> None:
        super().__init__(message)
        self.message = message
        self.reason = reason
        self.conflicts = conflicts


# --- draft corrections ------------------------------------------------------


class InvalidCorrection(DomainError):
    """A correction the draft cannot take as asked (422)."""


class EditableDraftNotFound(DomainError):
    def __init__(self, schedule_id: uuid.UUID) -> None:
        super().__init__("Nie znaleziono edytowalnego szkicu")
        self.schedule_id = schedule_id


class DraftChanged(DomainError):
    def __init__(self, schedule_id: uuid.UUID) -> None:
        super().__init__("Szkic zmienił się; odśwież generator")
        self.schedule_id = schedule_id


class DateOutsideDraft(InvalidCorrection):
    def __init__(self, service_date: date) -> None:
        super().__init__("Data jest poza zakresem szkicu")
        self.service_date = service_date


class LateShiftOnlyOnWorkingDays(InvalidCorrection):
    def __init__(self, service_date: date) -> None:
        super().__init__("Zmiana 11–19 jest dostępna tylko w dni robocze")
        self.service_date = service_date


class ReplacementNotFound(DomainError):
    def __init__(self, member_id: uuid.UUID) -> None:
        super().__init__("Nie znaleziono osoby")
        self.member_id = member_id


class ReplacementNotEligible(InvalidCorrection):
    def __init__(self, member_id: uuid.UUID, slot: Slot) -> None:
        super().__init__("Osoba nie ma eligibility")
        self.member_id = member_id
        self.slot = slot


class ReplacementUnavailable(InvalidCorrection):
    def __init__(self, member_id: uuid.UUID, service_date: date) -> None:
        super().__init__("Osoba jest niedostępna")
        self.member_id = member_id
        self.service_date = service_date


class DraftSlotNotFound(DomainError):
    def __init__(self, slot: Slot) -> None:
        super().__init__("Nie znaleziono przydziału w szkicu")
        self.slot = slot


class SecondOnCallSameDay(InvalidCorrection):
    def __init__(self, member_id: uuid.UUID, service_date: date) -> None:
        super().__init__("Osoba ma już drugi on-call tego dnia")
        self.member_id = member_id
        self.service_date = service_date


# --- comparing variants -----------------------------------------------------


class VariantNotFound(DomainError):
    def __init__(self) -> None:
        super().__init__("Nie znaleziono jednego z wariantów")


class IncomparableVariants(DomainError):
    """Two schedules that cannot be set side by side (422)."""


class VariantRangesDiffer(IncomparableVariants):
    def __init__(self) -> None:
        super().__init__("Porównywane warianty muszą obejmować ten sam zakres dat")


class VariantModesMismatch(IncomparableVariants):
    def __init__(self) -> None:
        super().__init__("Wybierz jeden wariant dzienny i jeden tygodniowy")


# --- lifecycle --------------------------------------------------------------


class ScheduleConflict(DomainError):
    """The schedule is not in a state the request can act on (409)."""


class ScheduleNotDeletable(ScheduleConflict):
    def __init__(self, schedule_id: uuid.UUID) -> None:
        super().__init__("Można usunąć tylko szkic, propozycję albo zaimportowaną historię")
        self.schedule_id = schedule_id


class DraftStateChanged(ScheduleConflict):
    def __init__(self, schedule_id: uuid.UUID) -> None:
        super().__init__("Szkic zmienił stan lub wersję; odśwież generator")
        self.schedule_id = schedule_id


class ProposalStateChanged(ScheduleConflict):
    def __init__(self, schedule_id: uuid.UUID) -> None:
        super().__init__("Propozycja zmieniła stan lub wersję")
        self.schedule_id = schedule_id


class PublicationStateChanged(ScheduleConflict):
    def __init__(self, schedule_id: uuid.UUID) -> None:
        super().__init__("Propozycja zmieniła stan lub wersję; odśwież generator")
        self.schedule_id = schedule_id


class OnlyProposalPublishable(ScheduleConflict):
    def __init__(self, schedule_id: uuid.UUID) -> None:
        super().__init__("Tylko propozycję można opublikować")
        self.schedule_id = schedule_id


class IncompleteSchedule(ScheduleConflict):
    def __init__(self) -> None:
        super().__init__("Grafik nie ma pełnego pokrycia")


class SamePersonOnBothOnCallRoles(ScheduleConflict):
    def __init__(self, service_date: date) -> None:
        super().__init__("Ta sama osoba nie może być primary i secondary jednego dnia")
        self.service_date = service_date


class UnavailablePeopleInSchedule(ScheduleConflict):
    """People with a hard „nie mogę" hold duties in the schedule."""

    reason = "UNAVAILABLE"

    def __init__(self, message: str, conflicts: tuple[UnavailabilityConflict, ...]) -> None:
        super().__init__(message)
        self.message = message
        self.conflicts = conflicts


class ProposalHasUnavailablePeople(UnavailablePeopleInSchedule):
    def __init__(self, conflicts: tuple[UnavailabilityConflict, ...]) -> None:
        super().__init__(
            "Szkic zawiera osoby z twardą niedostępnością. Popraw wskazane "
            "komórki korektą w macierzy szkicu albo wygeneruj grafik ponownie",
            conflicts,
        )


class PublicationHasUnavailablePeople(UnavailablePeopleInSchedule):
    def __init__(self, conflicts: tuple[UnavailabilityConflict, ...]) -> None:
        super().__init__(
            "Grafik zawiera osoby z twardą niedostępnością; wygeneruj go ponownie", conflicts
        )


class PublicationNeedsDecision(ScheduleConflict):
    """Publication would override something the coordinator has to confirm or
    resolve first. Each subclass carries what the screen shows for it."""

    reason: str


class LostChangesNotAcknowledged(PublicationNeedsDecision):
    reason = "LOST_CHANGES"

    def __init__(
        self,
        lost_changes: tuple[ProtectedChange, ...],
        pending_swaps: tuple[PendingSwapNotice, ...],
    ) -> None:
        super().__init__("Publikacja zastąpi ręczne zmiany; potwierdź ich utratę")
        self.lost_changes = lost_changes
        self.pending_swaps = pending_swaps


class ChangeResolutionRequired(PublicationNeedsDecision):
    reason = "CHANGE_RESOLUTION_REQUIRED"

    def __init__(self, slots: list[str]) -> None:
        super().__init__("Wybierz rozstrzygnięcie dla każdej kolidującej zmiany")
        self.slots = slots


class GapNotAcknowledged(PublicationNeedsDecision):
    reason = "UNCOVERED_BEFORE"

    def __init__(self, uncovered_before: tuple[date, ...]) -> None:
        super().__init__("Przed początkiem grafiku pozostają nieobsadzone dni")
        self.uncovered_before = uncovered_before


class ChangeResolutionInvalid(PublicationNeedsDecision):
    reason = "CHANGE_RESOLUTION_INVALID"

    def __init__(self, conflicts: dict[Slot, str]) -> None:
        super().__init__("Rozstrzygnięcie „zachowaj wcześniejszą zmianę” złamałoby reguły grafiku")
        self.conflicts = conflicts


class RestViolationsNotAcknowledged(PublicationNeedsDecision):
    reason = "REST_VIOLATIONS"

    def __init__(self, violations: tuple[RuleViolation, ...]) -> None:
        super().__init__("Publikacja naruszy reguły odpoczynku")
        self.violations = violations
