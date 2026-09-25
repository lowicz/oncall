import uuid
from datetime import date

from oncall.domain.errors import DomainError
from oncall.domain.vocabulary import AssignmentRole
from oncall.i18n import translate
from oncall.rules import RuleViolation


class LateShiftOnlyOnWorkingDays(DomainError):
    def __init__(self, service_date: date) -> None:
        super().__init__("overrides.late_shift_working_days_only")
        self.service_date = service_date


class PublishedScheduleNotFound(DomainError):
    def __init__(self, schedule_id: uuid.UUID | None) -> None:
        super().__init__("overrides.published_schedule_not_found")
        self.schedule_id = schedule_id


class PersonNotFound(DomainError):
    def __init__(self, member_id: uuid.UUID) -> None:
        super().__init__("overrides.person_not_found")
        self.member_id = member_id


class PersonNotEligible(DomainError):
    def __init__(self, member_id: uuid.UUID, role: AssignmentRole, service_date: date) -> None:
        super().__init__("overrides.person_not_eligible")
        self.member_id = member_id
        self.role = role
        self.service_date = service_date


class PersonUnavailable(DomainError):
    def __init__(self, member_id: uuid.UUID, service_date: date) -> None:
        super().__init__("overrides.person_unavailable")
        self.member_id = member_id
        self.service_date = service_date


class PersonAlreadyHoldsRole(DomainError):
    def __init__(self, member_id: uuid.UUID, service_date: date) -> None:
        super().__init__("overrides.person_already_holds_role")
        self.member_id = member_id
        self.service_date = service_date


class PersonAlreadyOnCall(DomainError):
    def __init__(self, member_id: uuid.UUID, service_date: date) -> None:
        super().__init__("overrides.person_already_on_call")
        self.member_id = member_id
        self.service_date = service_date


class RosterChangedMeanwhile(DomainError):
    """The schedule is no longer at the version the coordinator was looking at."""

    def __init__(self, schedule_id: uuid.UUID, expected_version: int) -> None:
        super().__init__("overrides.roster_changed_meanwhile")
        self.schedule_id = schedule_id
        self.expected_version = expected_version


class RepeatedSlotInBatch(DomainError):
    def __init__(self) -> None:
        super().__init__("overrides.repeated_slot_in_batch")


class EmptyBatch(DomainError):
    def __init__(self) -> None:
        super().__init__("overrides.empty_batch")


class ScheduleSlotNotFound(DomainError):
    def __init__(self, service_date: date, role: AssignmentRole) -> None:
        super().__init__("overrides.slot_not_found")
        self.service_date = service_date
        self.role = role


class HistoricalCorrectionNeedsReason(DomainError):
    def __init__(self, service_date: date) -> None:
        super().__init__("overrides.historical_correction_needs_reason")
        self.service_date = service_date


class BatchCorrectionNeedsReason(DomainError):
    def __init__(self) -> None:
        super().__init__("overrides.batch_correction_needs_reason")


class RuleViolationsNotAcknowledged(DomainError):
    """A correction that breaks a hard rule goes through only once the
    coordinator has seen the violations and explicitly acknowledged them."""

    reason = "RULE_VIOLATIONS"

    def __init__(self, violations: list[RuleViolation]) -> None:
        super().__init__("overrides.rule_violations_not_acknowledged")
        self.violations = violations

    @property
    def next_step(self) -> str:
        """What the coordinator does next, in the language of the request."""
        return translate("overrides.acknowledge_next_step")
