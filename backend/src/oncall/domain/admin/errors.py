import uuid

from oncall.domain.admin.models import slot_list
from oncall.domain.errors import DomainError
from oncall.domain.roster import Slot


class AccountNotFound(DomainError):
    def __init__(self, account_id: uuid.UUID) -> None:
        super().__init__("Nie znaleziono użytkownika")
        self.account_id = account_id


class RotationMemberNotFound(DomainError):
    def __init__(self, member_id: uuid.UUID) -> None:
        super().__init__("Nie znaleziono osoby w rotacji")
        self.member_id = member_id


class EligibilityNotFound(DomainError):
    def __init__(self, eligibility_id: uuid.UUID) -> None:
        super().__init__("Nie znaleziono okresu eligibility")
        self.eligibility_id = eligibility_id


FIRST_NAME_REQUIRED = "Imię nie może być puste"


class FirstNameRequired(DomainError):
    """A new account named only with whitespace."""

    def __init__(self) -> None:
        super().__init__(FIRST_NAME_REQUIRED)


class AdminConflict(DomainError):
    """The request is well formed but clashes with the state of accounts or
    the rotation."""


class FirstNameCleared(AdminConflict):
    def __init__(self) -> None:
        super().__init__(FIRST_NAME_REQUIRED)


class LastNameCleared(AdminConflict):
    def __init__(self) -> None:
        super().__init__("Nazwisko nie może być wartością null")


class UsernameTaken(AdminConflict):
    def __init__(self, username: str) -> None:
        super().__init__("Konto o takim loginie już istnieje")
        self.username = username


class EmailTaken(AdminConflict):
    def __init__(self, email: str) -> None:
        super().__init__("Konto o takim adresie e-mail już istnieje")
        self.email = email


class PersonnelNumberTaken(AdminConflict):
    def __init__(self, personnel_number: str) -> None:
        super().__init__("Numer pracownika jest już używany")
        self.personnel_number = personnel_number


class DirectoryIdentityReadOnly(AdminConflict):
    def __init__(self, fields: set[str]) -> None:
        super().__init__("Dane osobowe konta LDAP są zarządzane przez AD")
        self.fields = fields


class DirectoryPasswordReadOnly(AdminConflict):
    def __init__(self, account_id: uuid.UUID) -> None:
        super().__init__("Hasło konta LDAP jest zarządzane przez AD")
        self.account_id = account_id


class OwnRoleOrStatusChange(AdminConflict):
    def __init__(self) -> None:
        super().__init__("Nie możesz zmienić własnej roli ani statusu")


class LastActiveAdminDemotion(AdminConflict):
    def __init__(self, account_id: uuid.UUID) -> None:
        super().__init__("Nie można wyłączyć ani zdegradować ostatniego aktywnego administratora")
        self.account_id = account_id


class OwnAccountDeletion(AdminConflict):
    def __init__(self) -> None:
        super().__init__("Nie możesz usunąć własnego konta")


class LastActiveAdminDeletion(AdminConflict):
    def __init__(self, account_id: uuid.UUID) -> None:
        super().__init__("Nie można usunąć ostatniego aktywnego administratora")
        self.account_id = account_id


class AccountStillReferenced(AdminConflict):
    def __init__(self, account_id: uuid.UUID) -> None:
        super().__init__(
            "Nie można usunąć konta, bo jest powiązane z innymi danymi. "
            "Dezaktywuj konto albo usuń powiązania."
        )
        self.account_id = account_id


class AccountAlreadyInRotation(AdminConflict):
    def __init__(self, account_id: uuid.UUID) -> None:
        super().__init__("Konto jest już przypisane do rotacji")
        self.account_id = account_id


class MembershipEndsBeforeStart(AdminConflict):
    def __init__(self) -> None:
        super().__init__("Data wyjścia z rotacji nie może poprzedzać daty wejścia")


class EligibilityOutlivesMembership(AdminConflict):
    """A membership change would leave existing periods outside it."""

    def __init__(self) -> None:
        super().__init__("Okresy eligibility muszą mieścić się w okresie członkostwa w rotacji")


class DutiesAfterExit(AdminConflict):
    def __init__(self, slots: list[Slot]) -> None:
        super().__init__(
            "Osoba ma dyżury po dacie wyjścia z rotacji. "
            f"Najpierw przepisz lub zwolnij sloty: {slot_list(slots)}"
        )
        self.slots = slots


class EligibilityOutsideMembership(AdminConflict):
    """A period granted or changed would not fit the membership."""

    def __init__(self) -> None:
        super().__init__("Okres eligibility musi mieścić się w okresie członkostwa w rotacji")


class EligibilityEndsBeforeStart(AdminConflict):
    def __init__(self) -> None:
        super().__init__("Data końcowa nie może poprzedzać daty początkowej")


class EligibilityOverlaps(AdminConflict):
    def __init__(self) -> None:
        super().__init__("Okres eligibility nakłada się na istniejący okres tej roli")


class DutiesLoseEligibility(AdminConflict):
    def __init__(self, slots: list[Slot]) -> None:
        super().__init__(
            "Zmiana eligibility pozostawiłaby opublikowane dyżury bez uprawnień. "
            f"Najpierw przepisz sloty: {slot_list(slots)}"
        )
        self.slots = slots
