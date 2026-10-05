from oncall.domain.errors import DomainError
from oncall.i18n import translate
from oncall.rules import RuleViolation


class SwapInThePast(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.in_the_past")


class SlotNotPublished(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.slot_not_published")


class SlotNotYours(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.slot_not_yours")


class ReplacementNotEligible(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.replacement_not_eligible")


class CannotSwapWithYourself(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.cannot_swap_with_yourself")


class ReplacementHasNoAccount(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.replacement_has_no_account")


class ReplacementUnavailable(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.replacement_unavailable")


class ReplacementAlreadyOnCall(DomainError):
    """The request would give the replacement both on-call roles on a day."""

    def __init__(self) -> None:
        super().__init__("swaps.replacement_already_on_call")


class ReplacementOnCallSinceRequest(ReplacementAlreadyOnCall):
    """Same break, found at approval: the roster moved after the request."""


class ReturnOnTheSameDay(DomainError):
    """An exchange trades two days; a trade of roles within one day is not
    a request this version takes."""

    def __init__(self) -> None:
        super().__init__("swaps.return_on_the_same_day")


class ReturnSlotNotTheirs(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.return_slot_not_theirs")


class RequesterNotEligible(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.requester_not_eligible")


class RequesterUnavailable(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.requester_unavailable")


class SlotHasActiveSwap(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.slot_has_active_swap")


class SwapBreaksHardRules(DomainError):
    def __init__(self, violations: list[RuleViolation]) -> None:
        super().__init__("swaps.breaks_hard_rules")
        self.violations = violations

    @property
    def next_step(self) -> str:
        """One sentence on what to do instead, in the language of the request."""
        return translate("swaps.blocked_next_step")


class SwapRuleViolationsNotAcknowledged(DomainError):
    """A swap that breaks a hard rule goes ahead only once the person asking
    for it or deciding on it has seen the violations and acknowledged them."""

    reason = "RULE_VIOLATIONS"

    def __init__(self, violations: list[RuleViolation]) -> None:
        super().__init__("swaps.rule_violations_not_acknowledged")
        self.violations = violations

    @property
    def next_step(self) -> str:
        """What that person does next, in the language of the request."""
        return translate("swaps.acknowledge_next_step")


class RuleBreakingSwapNeedsReason(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.rule_breaking_swap_needs_reason")


class SwapNotFound(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.not_found")


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
    def __init__(self) -> None:
        super().__init__("swaps.schedule_changed_since_request")


class PointsHiddenFromViewers(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.points_hidden_from_viewers")


class ReplacementNotFound(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.replacement_not_found")


class NoPublicationForDay(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.no_publication_for_day")


class SlotHasNoPublishedDuty(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.slot_has_no_published_duty")


class SlotHolderNotATeamMember(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.slot_holder_not_a_team_member")


class OnlyOwnSwapsPreview(DomainError):
    def __init__(self) -> None:
        super().__init__("swaps.only_own_swaps_preview")


class NoBalanceInWindow(DomainError):
    def __init__(self, display_name: str) -> None:
        super().__init__("swaps.no_balance_in_window", display_name=display_name)
