from oncall.domain.admin.models import slot_list
from oncall.domain.errors import DomainError
from oncall.domain.roster import Slot


class AccountNotFound(DomainError):
    def __init__(self) -> None:
        super().__init__("admin.account_not_found")


class RotationMemberNotFound(DomainError):
    def __init__(self) -> None:
        super().__init__("admin.rotation_member_not_found")


class EligibilityNotFound(DomainError):
    def __init__(self) -> None:
        super().__init__("admin.eligibility_not_found")


class FirstNameRequired(DomainError):
    """A new account named only with whitespace."""

    def __init__(self) -> None:
        super().__init__("admin.first_name_required")


class AdminConflict(DomainError):
    """The request is well formed but clashes with the state of accounts or
    the rotation."""


class FirstNameCleared(AdminConflict):
    def __init__(self) -> None:
        super().__init__("admin.first_name_required")


class LastNameCleared(AdminConflict):
    def __init__(self) -> None:
        super().__init__("admin.last_name_cleared")


class UsernameTaken(AdminConflict):
    def __init__(self) -> None:
        super().__init__("admin.username_taken")


class EmailTaken(AdminConflict):
    def __init__(self) -> None:
        super().__init__("admin.email_taken")


class PersonnelNumberTaken(AdminConflict):
    def __init__(self) -> None:
        super().__init__("admin.personnel_number_taken")


class DirectoryIdentityReadOnly(AdminConflict):
    def __init__(self) -> None:
        super().__init__("admin.directory_identity_read_only")


class DirectoryPasswordReadOnly(AdminConflict):
    def __init__(self) -> None:
        super().__init__("admin.directory_password_read_only")


class AccountAlreadyActivated(AdminConflict):
    def __init__(self) -> None:
        super().__init__("admin.account_already_activated")


class DisabledAccountActivation(AdminConflict):
    def __init__(self) -> None:
        super().__init__("admin.disabled_account_activation")


class OwnRoleOrStatusChange(AdminConflict):
    def __init__(self) -> None:
        super().__init__("admin.own_role_or_status_change")


class LastActiveAdminDemotion(AdminConflict):
    def __init__(self) -> None:
        super().__init__("admin.last_active_admin_demotion")


class OwnAccountDeletion(AdminConflict):
    def __init__(self) -> None:
        super().__init__("admin.own_account_deletion")


class LastActiveAdminDeletion(AdminConflict):
    def __init__(self) -> None:
        super().__init__("admin.last_active_admin_deletion")


class AccountStillReferenced(AdminConflict):
    def __init__(self) -> None:
        super().__init__("admin.account_still_referenced")


class AccountAlreadyInRotation(AdminConflict):
    def __init__(self) -> None:
        super().__init__("admin.account_already_in_rotation")


class MembershipEndsBeforeStart(AdminConflict):
    def __init__(self) -> None:
        super().__init__("admin.membership_ends_before_start")


class EligibilityOutlivesMembership(AdminConflict):
    """A membership change would leave existing periods outside it."""

    def __init__(self) -> None:
        super().__init__("admin.eligibility_outlives_membership")


class DutiesAfterExit(AdminConflict):
    def __init__(self, slots: list[Slot]) -> None:
        super().__init__("admin.duties_after_exit", slots=slot_list(slots))


class EligibilityOutsideMembership(AdminConflict):
    """A period granted or changed would not fit the membership."""

    def __init__(self) -> None:
        super().__init__("admin.eligibility_outside_membership")


class EligibilityEndsBeforeStart(AdminConflict):
    def __init__(self) -> None:
        super().__init__("admin.eligibility_ends_before_start")


class EligibilityOverlaps(AdminConflict):
    def __init__(self) -> None:
        super().__init__("admin.eligibility_overlaps")


class DutiesLoseEligibility(AdminConflict):
    def __init__(self, slots: list[Slot]) -> None:
        super().__init__("admin.duties_lose_eligibility", slots=slot_list(slots))
