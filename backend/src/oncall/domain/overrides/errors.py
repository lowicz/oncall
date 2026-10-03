from oncall.domain.errors import DomainError
from oncall.i18n import translate
from oncall.rules import RuleViolation


class LateShiftOnlyOnWorkingDays(DomainError):
    def __init__(self) -> None:
        super().__init__("overrides.late_shift_working_days_only")


class PublishedScheduleNotFound(DomainError):
    def __init__(self) -> None:
        super().__init__("overrides.published_schedule_not_found")


class PersonNotFound(DomainError):
    def __init__(self) -> None:
        super().__init__("overrides.person_not_found")


class PersonNotEligible(DomainError):
    def __init__(self) -> None:
        super().__init__("overrides.person_not_eligible")


class PersonUnavailable(DomainError):
    def __init__(self) -> None:
        super().__init__("overrides.person_unavailable")


class PersonAlreadyHoldsRole(DomainError):
    def __init__(self) -> None:
        super().__init__("overrides.person_already_holds_role")


class PersonAlreadyOnCall(DomainError):
    def __init__(self) -> None:
        super().__init__("overrides.person_already_on_call")


class RosterChangedMeanwhile(DomainError):
    """The schedule is no longer at the version the coordinator was looking at."""

    def __init__(self) -> None:
        super().__init__("overrides.roster_changed_meanwhile")


class RepeatedSlotInBatch(DomainError):
    def __init__(self) -> None:
        super().__init__("overrides.repeated_slot_in_batch")


class EmptyBatch(DomainError):
    def __init__(self) -> None:
        super().__init__("overrides.empty_batch")


class ScheduleSlotNotFound(DomainError):
    def __init__(self) -> None:
        super().__init__("overrides.slot_not_found")


class HistoricalCorrectionNeedsReason(DomainError):
    def __init__(self) -> None:
        super().__init__("overrides.historical_correction_needs_reason")


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
