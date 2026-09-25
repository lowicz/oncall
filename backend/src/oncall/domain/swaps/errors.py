import uuid
from datetime import date

from oncall.domain.errors import DomainError
from oncall.i18n import translate
from oncall.rules import RuleViolation


class SwapInThePast(DomainError):
    def __init__(self, service_date: date) -> None:
        super().__init__("swaps.in_the_past")
        self.service_date = service_date


class SlotNotPublished(DomainError):
    def __init__(self, service_date: date) -> None:
        super().__init__("swaps.slot_not_published")
        self.service_date = service_date


class SlotNotYours(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.slot_not_yours")


class ReplacementNotEligible(DomainError):
    def __init__(self, member_id: uuid.UUID) -> None:
        super().__init__("swaps.replacement_not_eligible")
        self.member_id = member_id


class CannotSwapWithYourself(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.cannot_swap_with_yourself")


class ReplacementHasNoAccount(DomainError):
    def __init__(self, member_id: uuid.UUID) -> None:
        super().__init__("swaps.replacement_has_no_account")
        self.member_id = member_id


class ReplacementUnavailable(DomainError):
    def __init__(self, member_id: uuid.UUID, service_date: date) -> None:
        super().__init__("swaps.replacement_unavailable")
        self.member_id = member_id
        self.service_date = service_date


class ReplacementAlreadyOnCall(DomainError):
    """The request would give the replacement both on-call roles on a day."""

    def __init__(self, service_date: date) -> None:
        super().__init__("swaps.replacement_already_on_call")
        self.service_date = service_date


class ReplacementOnCallSinceRequest(ReplacementAlreadyOnCall):
    """Same break, found at approval: the roster moved after the request."""


class SlotHasActiveSwap(DomainError):
    def __init__(self, service_date: date) -> None:
        super().__init__("swaps.slot_has_active_swap")
        self.service_date = service_date


class SwapBreaksHardRules(DomainError):
    def __init__(self, violations: list[RuleViolation]) -> None:
        super().__init__("swaps.breaks_hard_rules")
        self.violations = violations

    @property
    def next_step(self) -> str:
        """One sentence on what to do instead, in the language of the request."""
        return translate("swaps.blocked_next_step")


class SwapNotFound(DomainError):
    def __init__(self, swap_id: uuid.UUID) -> None:
        super().__init__("swaps.not_found")
        self.swap_id = swap_id


class OnlyNamedReplacementMayAccept(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.only_named_replacement_may_accept")


class OnlyNamedReplacementMayReject(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.only_named_replacement_may_reject")


class OnlyCoordinatorMayRejectAccepted(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.only_coordinator_may_reject_accepted")


class OnlyRequesterMayCancel(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.only_requester_may_cancel")


class SwapNotAwaitingReplacement(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.not_awaiting_replacement")


class SwapNotAwaitingCoordinator(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.not_awaiting_coordinator")


class SwapNoLongerRejectable(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.no_longer_rejectable")


class SwapNoLongerCancellable(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.no_longer_cancellable")


class DecisionReasonRequired(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.decision_reason_required")


class SwapPartiesGone(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.parties_gone")


class SelfApprovalNotAllowed(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.self_approval_not_allowed")


class ScheduleChangedSinceRequest(DomainError):
    def __init__(self, schedule_id: uuid.UUID) -> None:
        super().__init__("swaps.schedule_changed_since_request")
        self.schedule_id = schedule_id


class PointsHiddenFromViewers(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.points_hidden_from_viewers")


class ReplacementNotFound(DomainError):
    def __init__(self, member_id: uuid.UUID) -> None:
        super().__init__("swaps.replacement_not_found")
        self.member_id = member_id


class NoPublicationForDay(DomainError):
    def __init__(self, service_date: date) -> None:
        super().__init__("swaps.no_publication_for_day")
        self.service_date = service_date


class SlotHasNoPublishedDuty(DomainError):
    def __init__(self, service_date: date) -> None:
        super().__init__("swaps.slot_has_no_published_duty")
        self.service_date = service_date


class SlotHolderNotATeamMember(DomainError):
    def __init__(self, assignee_name: str) -> None:
        super().__init__("swaps.slot_holder_not_a_team_member")
        self.assignee_name = assignee_name


class OnlyOwnSwapsPreview(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.only_own_swaps_preview")


class NoBalanceInWindow(DomainError):
    def __init__(self, display_name: str) -> None:
        super().__init__("swaps.no_balance_in_window", display_name=display_name)
        self.display_name = display_name
