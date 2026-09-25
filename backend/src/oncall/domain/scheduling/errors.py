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
        super().__init__("scheduling.schedule_not_found")
        self.schedule_id = schedule_id


class GenerationRunNotFound(DomainError):
    def __init__(self, run_id: uuid.UUID) -> None:
        super().__init__("scheduling.generation_run_not_found")
        self.run_id = run_id


class PolicyWithoutWeight(DomainError):
    def __init__(self) -> None:
        super().__init__("scheduling.policy_without_weight")


#: The solver's failure reasons that have a sentence of their own.
_FAILURE_KEYS = {
    "PRECHECK": "scheduling.generation_failed.precheck",
    "INFEASIBLE": "scheduling.generation_failed.infeasible",
    "UNKNOWN": "scheduling.generation_failed.unknown",
}


class GenerationFailed(DomainError):
    """The solver could not fill the horizon; nothing was stored."""

    def __init__(self, reason: str | None, conflicts: tuple[str, ...]) -> None:
        super().__init__(_FAILURE_KEYS.get(reason or "", "scheduling.generation_failed"))
        self.reason = reason
        self.conflicts = conflicts

    @property
    def message(self) -> str:
        return str(self)


# --- draft corrections ------------------------------------------------------


class InvalidCorrection(DomainError):
    """A correction the draft cannot take as asked (422)."""


class EditableDraftNotFound(DomainError):
    def __init__(self, schedule_id: uuid.UUID) -> None:
        super().__init__("scheduling.editable_draft_not_found")
        self.schedule_id = schedule_id


class DraftChanged(DomainError):
    def __init__(self, schedule_id: uuid.UUID) -> None:
        super().__init__("scheduling.draft_changed")
        self.schedule_id = schedule_id


class DateOutsideDraft(InvalidCorrection):
    def __init__(self, service_date: date) -> None:
        super().__init__("scheduling.date_outside_draft")
        self.service_date = service_date


class LateShiftOnlyOnWorkingDays(InvalidCorrection):
    def __init__(self, service_date: date) -> None:
        super().__init__("scheduling.late_shift_working_days_only")
        self.service_date = service_date


class ReplacementNotFound(DomainError):
    def __init__(self, member_id: uuid.UUID) -> None:
        super().__init__("scheduling.replacement_not_found")
        self.member_id = member_id


class ReplacementNotEligible(InvalidCorrection):
    def __init__(self, member_id: uuid.UUID, slot: Slot) -> None:
        super().__init__("scheduling.replacement_not_eligible")
        self.member_id = member_id
        self.slot = slot


class ReplacementUnavailable(InvalidCorrection):
    def __init__(self, member_id: uuid.UUID, service_date: date) -> None:
        super().__init__("scheduling.replacement_unavailable")
        self.member_id = member_id
        self.service_date = service_date


class DraftSlotNotFound(DomainError):
    def __init__(self, slot: Slot) -> None:
        super().__init__("scheduling.draft_slot_not_found")
        self.slot = slot


class SecondOnCallSameDay(InvalidCorrection):
    def __init__(self, member_id: uuid.UUID, service_date: date) -> None:
        super().__init__("scheduling.second_on_call_same_day")
        self.member_id = member_id
        self.service_date = service_date


# --- comparing variants -----------------------------------------------------


class VariantNotFound(DomainError):
    def __init__(self) -> None:
        super().__init__("scheduling.variant_not_found")


class IncomparableVariants(DomainError):
    """Two schedules that cannot be set side by side (422)."""


class VariantRangesDiffer(IncomparableVariants):
    def __init__(self) -> None:
        super().__init__("scheduling.variant_ranges_differ")


class VariantModesMismatch(IncomparableVariants):
    def __init__(self) -> None:
        super().__init__("scheduling.variant_modes_mismatch")


# --- lifecycle --------------------------------------------------------------


class ScheduleConflict(DomainError):
    """The schedule is not in a state the request can act on (409)."""


class ScheduleNotDeletable(ScheduleConflict):
    def __init__(self, schedule_id: uuid.UUID) -> None:
        super().__init__("scheduling.schedule_not_deletable")
        self.schedule_id = schedule_id


class DraftStateChanged(ScheduleConflict):
    def __init__(self, schedule_id: uuid.UUID) -> None:
        super().__init__("scheduling.draft_state_changed")
        self.schedule_id = schedule_id


class ProposalStateChanged(ScheduleConflict):
    def __init__(self, schedule_id: uuid.UUID) -> None:
        super().__init__("scheduling.proposal_state_changed")
        self.schedule_id = schedule_id


class PublicationStateChanged(ScheduleConflict):
    def __init__(self, schedule_id: uuid.UUID) -> None:
        super().__init__("scheduling.publication_state_changed")
        self.schedule_id = schedule_id


class OnlyProposalPublishable(ScheduleConflict):
    def __init__(self, schedule_id: uuid.UUID) -> None:
        super().__init__("scheduling.only_proposal_publishable")
        self.schedule_id = schedule_id


class IncompleteSchedule(ScheduleConflict):
    def __init__(self) -> None:
        super().__init__("scheduling.incomplete_schedule")


class SamePersonOnBothOnCallRoles(ScheduleConflict):
    def __init__(self, service_date: date) -> None:
        super().__init__("scheduling.same_person_on_both_on_call_roles")
        self.service_date = service_date


class UnavailablePeopleInSchedule(ScheduleConflict):
    """People with a hard `unavailable` entry hold duties in the schedule."""

    reason = "UNAVAILABLE"

    def __init__(self, key: str, conflicts: tuple[UnavailabilityConflict, ...]) -> None:
        super().__init__(key)
        self.conflicts = conflicts

    @property
    def message(self) -> str:
        return str(self)


class ProposalHasUnavailablePeople(UnavailablePeopleInSchedule):
    def __init__(self, conflicts: tuple[UnavailabilityConflict, ...]) -> None:
        super().__init__("scheduling.proposal_has_unavailable_people", conflicts)


class PublicationHasUnavailablePeople(UnavailablePeopleInSchedule):
    def __init__(self, conflicts: tuple[UnavailabilityConflict, ...]) -> None:
        super().__init__("scheduling.publication_has_unavailable_people", conflicts)


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
        super().__init__("scheduling.lost_changes_not_acknowledged")
        self.lost_changes = lost_changes
        self.pending_swaps = pending_swaps


class ChangeResolutionRequired(PublicationNeedsDecision):
    reason = "CHANGE_RESOLUTION_REQUIRED"

    def __init__(self, slots: list[str]) -> None:
        super().__init__("scheduling.change_resolution_required")
        self.slots = slots


class GapNotAcknowledged(PublicationNeedsDecision):
    reason = "UNCOVERED_BEFORE"

    def __init__(self, uncovered_before: tuple[date, ...]) -> None:
        super().__init__("scheduling.gap_not_acknowledged")
        self.uncovered_before = uncovered_before


class ChangeResolutionInvalid(PublicationNeedsDecision):
    reason = "CHANGE_RESOLUTION_INVALID"

    def __init__(self, conflicts: dict[Slot, str]) -> None:
        super().__init__("scheduling.change_resolution_invalid")
        self.conflicts = conflicts


class RestViolationsNotAcknowledged(PublicationNeedsDecision):
    reason = "REST_VIOLATIONS"

    def __init__(self, violations: tuple[RuleViolation, ...]) -> None:
        super().__init__("scheduling.rest_violations_not_acknowledged")
        self.violations = violations
