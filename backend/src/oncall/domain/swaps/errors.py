import uuid
from datetime import date

from oncall.domain.errors import DomainError
from oncall.rules import RuleViolation


class SwapInThePast(DomainError):
    def __init__(self, service_date: date) -> None:
        super().__init__("Nie można zamienić dyżuru, który już się odbył")
        self.service_date = service_date


class SlotNotPublished(DomainError):
    def __init__(self, service_date: date) -> None:
        super().__init__("Nie znaleziono opublikowanego grafiku")
        self.service_date = service_date


class SlotNotYours(DomainError):
    def __init__(self) -> None:
        super().__init__("Ten slot nie należy do Ciebie")


class ReplacementNotEligible(DomainError):
    def __init__(self, member_id: uuid.UUID) -> None:
        super().__init__("Zastępca nie ma eligibility")
        self.member_id = member_id


class CannotSwapWithYourself(DomainError):
    def __init__(self) -> None:
        super().__init__("Nie można zamienić się ze sobą")


class ReplacementHasNoAccount(DomainError):
    def __init__(self, member_id: uuid.UUID) -> None:
        super().__init__("Zastępca nie ma konta")
        self.member_id = member_id


class ReplacementUnavailable(DomainError):
    def __init__(self, member_id: uuid.UUID, service_date: date) -> None:
        super().__init__("Zastępca jest niedostępny")
        self.member_id = member_id
        self.service_date = service_date


class ReplacementAlreadyOnCall(DomainError):
    """The request would give the replacement both on-call roles on a day."""

    def __init__(self, service_date: date) -> None:
        super().__init__("Zastępca ma już drugi on-call tego dnia")
        self.service_date = service_date


class ReplacementOnCallSinceRequest(ReplacementAlreadyOnCall):
    """Same break, found at approval: the roster moved after the request."""


class SlotHasActiveSwap(DomainError):
    def __init__(self, service_date: date) -> None:
        super().__init__("Dla tego slotu istnieje aktywna zamiana")
        self.service_date = service_date


#: One sentence, ending in a next step, for a swap the hard rules block
#: (PLAN.md par. 6).
BLOCKED_NEXT_STEP = "Wybierz inny dzień albo poproś koordynatora o korektę grafiku."


class SwapBreaksHardRules(DomainError):
    def __init__(self, violations: list[RuleViolation]) -> None:
        super().__init__("Operacja łamie reguły twarde grafiku")
        self.violations = violations
        self.next_step = BLOCKED_NEXT_STEP


class SwapNotFound(DomainError):
    def __init__(self, swap_id: uuid.UUID) -> None:
        super().__init__("Nie znaleziono zamiany")
        self.swap_id = swap_id


class OnlyNamedReplacementMayAccept(DomainError):
    def __init__(self) -> None:
        super().__init__("Tylko wskazany zastępca może zaakceptować")


class OnlyNamedReplacementMayReject(DomainError):
    def __init__(self) -> None:
        super().__init__("Tylko wskazany zastępca może odrzucić prośbę")


class OnlyCoordinatorMayRejectAccepted(DomainError):
    def __init__(self) -> None:
        super().__init__("Tylko koordynator może odrzucić zaakceptowaną prośbę")


class OnlyRequesterMayCancel(DomainError):
    def __init__(self) -> None:
        super().__init__("Tylko autor może wycofać prośbę")


class SwapNotAwaitingReplacement(DomainError):
    def __init__(self) -> None:
        super().__init__("Zamiana nie oczekuje na zastępcę")


class SwapNotAwaitingCoordinator(DomainError):
    def __init__(self) -> None:
        super().__init__("Zamiana nie oczekuje na koordynatora")


class SwapNoLongerRejectable(DomainError):
    def __init__(self) -> None:
        super().__init__("Tej zamiany nie można już odrzucić")


class SwapNoLongerCancellable(DomainError):
    def __init__(self) -> None:
        super().__init__("Tej zamiany nie można już wycofać")


class DecisionReasonRequired(DomainError):
    def __init__(self) -> None:
        super().__init__("Podaj powód decyzji")


class SwapPartiesGone(DomainError):
    def __init__(self) -> None:
        super().__init__("Grafik lub zastępca już nie istnieje")


class SelfApprovalNotAllowed(DomainError):
    def __init__(self) -> None:
        super().__init__("Własną zamianę zatwierdza inny koordynator")


class ScheduleChangedSinceRequest(DomainError):
    def __init__(self, schedule_id: uuid.UUID) -> None:
        super().__init__("Grafik zmienił się; utwórz nową zamianę")
        self.schedule_id = schedule_id


#: Why an approval turned into an automatic cancellation; stored on the request.
SLOT_CHANGED_OWNER_NOTE = "Slot zmienił właściciela przed zatwierdzeniem"
SLOT_CHANGED_OWNER_MESSAGE = "Slot zmienił właściciela; prośba została automatycznie anulowana"


class PointsHiddenFromViewers(DomainError):
    def __init__(self) -> None:
        super().__init__("Punkty są widoczne tylko dla zespołu")


class ReplacementNotFound(DomainError):
    def __init__(self, member_id: uuid.UUID) -> None:
        super().__init__("Nie znaleziono zastępcy")
        self.member_id = member_id


class NoPublicationForDay(DomainError):
    def __init__(self, service_date: date) -> None:
        super().__init__("Brak opublikowanego grafiku na ten dzień")
        self.service_date = service_date


class SlotHasNoPublishedDuty(DomainError):
    def __init__(self, service_date: date) -> None:
        super().__init__("Ten slot nie ma opublikowanego przydziału")
        self.service_date = service_date


class SlotHolderNotATeamMember(DomainError):
    def __init__(self, assignee_name: str) -> None:
        super().__init__("Osoba z tego slotu nie jest członkiem zespołu")
        self.assignee_name = assignee_name


class OnlyOwnSwapsPreview(DomainError):
    def __init__(self) -> None:
        super().__init__("Możesz sprawdzić tylko własne zamiany")


class NoBalanceInWindow(DomainError):
    def __init__(self, display_name: str) -> None:
        super().__init__(f"Brak bilansu dla osoby {display_name} w tym oknie")
        self.display_name = display_name
