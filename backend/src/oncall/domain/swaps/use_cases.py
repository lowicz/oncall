"""Swap use cases.

The order of the checks is part of the behaviour: when a request is wrong in
two ways, the first failing rule is the one the person is told about.
"""

import uuid
from collections.abc import Callable
from dataclasses import replace
from datetime import date

from oncall.domain.clock import business_today
from oncall.domain.errors import NotATeamMember
from oncall.domain.hard_rules import substitution_check
from oncall.domain.overrides.models import MIN_REASON_LENGTH
from oncall.domain.ports import PublishedRoster, TeamDirectory
from oncall.domain.roster import OPPOSITE_ONCALL, Slot, holder_names, rule_window
from oncall.domain.swaps.coupling import (
    has_anchor_exception,
    moves_for,
    partition_violations,
    takes_second_oncall,
)
from oncall.domain.swaps.errors import (
    CannotSwapWithYourself,
    DecisionReasonRequired,
    NoBalanceInWindow,
    NoPublicationForDay,
    OnlyCoordinatorMayRejectAccepted,
    OnlyNamedReplacementMayAccept,
    OnlyNamedReplacementMayReject,
    OnlyOwnSwapsPreview,
    OnlyRequesterMayCancel,
    PointsHiddenFromViewers,
    ReplacementAlreadyOnCall,
    ReplacementHasNoAccount,
    ReplacementNotEligible,
    ReplacementNotFound,
    ReplacementOnCallSinceRequest,
    ReplacementUnavailable,
    RuleBreakingSwapNeedsReason,
    ScheduleChangedSinceRequest,
    SelfApprovalNotAllowed,
    SlotHasActiveSwap,
    SlotHasNoPublishedDuty,
    SlotHolderNotATeamMember,
    SlotNotPublished,
    SlotNotYours,
    SwapBreaksHardRules,
    SwapInThePast,
    SwapNoLongerCancellable,
    SwapNoLongerRejectable,
    SwapNotAwaitingCoordinator,
    SwapNotAwaitingReplacement,
    SwapNotFound,
    SwapPartiesGone,
    SwapRuleViolationsNotAcknowledged,
)
from oncall.domain.swaps.models import (
    SLOT_CHANGED_OWNER_NOTE,
    NewSwapRequest,
    ReplacementOption,
    ReplacementOptionsQuery,
    SwapAutoCancelled,
    SwapDecisionInput,
    SwapImpact,
    SwapImpactQuery,
    SwapImpactSide,
    SwapListQuery,
    SwapPolicy,
    SwapRequest,
    SwapRequestInput,
    SwapRequestView,
    acknowledged_violations,
)
from oncall.domain.swaps.ports import SwapPorts
from oncall.domain.team import Actor, Member
from oncall.domain.vocabulary import SwapStatus, UserRole
from oncall.fairness import MemberBalance, compute_fairness, day_weight, reassign, window
from oncall.i18n import translate
from oncall.rules import RuleViolation, substitution_violations
from oncall.workdays import polish_holidays


async def _member_for(actor: Actor, team: TeamDirectory) -> Member:
    member = await team.member_for_account(actor.user_id)
    if member is None:
        raise NotATeamMember()
    return member


async def _takes_opposite_oncall(
    roster: PublishedRoster, schedule_id: uuid.UUID, move: Slot, replacement: Member
) -> bool:
    """Whether the replacement already holds the opposite on-call role of this
    slot in the schedule the request belongs to."""
    move_date, move_role = move
    opposite = OPPOSITE_ONCALL.get(move_role)
    if opposite is None:
        return False
    duty = await roster.duty(schedule_id, (move_date, opposite))
    return duty is not None and duty.held_by(replacement.id, replacement.display_name)


def _reject_past(request: SwapRequest, today: date) -> None:
    if any(day < today for day, _role in request.moves):
        raise SwapInThePast()


def _require_reason(reason: str | None) -> None:
    if reason is None or not reason.strip():
        raise DecisionReasonRequired()


def _named(request: SwapRequest, requester_name: str, replacement_name: str) -> SwapRequestView:
    """The request as a person reads it, with the violations it keeps."""
    return SwapRequestView(
        request=request,
        requester_name=requester_name,
        replacement_name=replacement_name,
        rule_violations=request.named_violations(requester_name, replacement_name),
    )


async def _view(request: SwapRequest, team: TeamDirectory) -> SwapRequestView:
    names = await team.display_names((request.requester_member_id, request.replacement_member_id))
    return _named(request, names[request.requester_member_id], names[request.replacement_member_id])


#: A request and the names of its requester and replacement, to the rules it
#: is refused by, the ones it breaks only with an acknowledgement and the ones
#: it bends (`partition_violations`).
RuleTiers = Callable[
    [SwapRequest, str, str],
    tuple[list[RuleViolation], list[RuleViolation], list[RuleViolation]],
]


async def _rule_tiers(requests: list[SwapRequest], ports: SwapPorts) -> RuleTiers:
    """How these requests stand against the hard rules on the roster as it is
    now. One read of the roster covers all of them."""
    window_start, window_end = rule_window(
        [day for request in requests for day, _role in request.moves]
    )
    holders = holder_names(await ports.roster.duties_in_force(window_start, window_end))
    anchor = await ports.policy.late_shift_anchor()
    mode = await ports.policy.rotation_mode()
    holidays = polish_holidays(window_start, window_end)

    def tiers(
        request: SwapRequest, requester_name: str, replacement_name: str
    ) -> tuple[list[RuleViolation], list[RuleViolation], list[RuleViolation]]:
        violations = substitution_violations(
            holders, request.moves, requester_name, replacement_name, anchor, holidays, mode
        )
        return partition_violations(
            violations, anchor_exception=has_anchor_exception(request.moves, anchor, holidays)
        )

    return tiers


async def list_replacement_options(
    query: ReplacementOptionsQuery, ports: SwapPorts, *, today: date | None = None
) -> list[ReplacementOption]:
    """Colleagues who could take the slot, each with what picking them means."""
    if query.service_date < (today or business_today()):
        return []
    requester = await _member_for(query.actor, ports.team)
    conflicting_member_id = None
    conflicting_assignee_name = None
    publication = await ports.roster.latest_publication_covering(query.service_date)
    opposite = OPPOSITE_ONCALL.get(query.role)
    if publication is not None and opposite is not None:
        conflicting = await ports.roster.duty(publication.id, (query.service_date, opposite))
        if conflicting is not None:
            conflicting_member_id = conflicting.member_id
            conflicting_assignee_name = conflicting.assignee_name
    colleagues = await ports.team.colleagues_of(requester.id)
    offered = [
        member
        for member in colleagues
        if member.has_account
        and member.id != conflicting_member_id
        and (conflicting_member_id is not None or member.display_name != conflicting_assignee_name)
        and member.is_eligible(query.role, query.service_date)
        and not member.is_unavailable(query.service_date)
    ]
    # Both facts a person compares candidates by come from this one resolved
    # window; the balance is deliberately left to the impact preview.
    window_start, window_end = rule_window([query.service_date])
    duties = await ports.roster.duties_in_force(window_start, window_end)
    anchor = await ports.policy.late_shift_anchor()
    holidays = polish_holidays(window_start, window_end)
    holders = holder_names(duties)
    on_duty = {
        duty.member_id
        for (day, _role), duty in duties.items()
        if day == query.service_date and duty.member_id is not None
    }
    options: list[ReplacementOption] = []
    for member in offered:
        moves, anchor_exception = moves_for(
            service_date=query.service_date,
            role=query.role,
            requester=requester,
            replacement=member,
            duties=duties,
            anchor=anchor,
            holidays=holidays,
        )
        violations = substitution_violations(
            holders,
            moves,
            requester.display_name,
            member.display_name,
            anchor,
            holidays,
            await ports.policy.rotation_mode(),
        )
        blocking, to_acknowledge, warnings = partition_violations(
            violations, anchor_exception=anchor_exception
        )
        # A coupled swap can hand the candidate a second on-call role the
        # clicked-slot filter never saw; `request_swap` refuses that, so the
        # option must say so rather than be offered and then refused.
        if takes_second_oncall(duties, moves, member):
            blocking.append(
                RuleViolation("double_oncall", member.display_name, (query.service_date,))
            )
        options.append(
            ReplacementOption(
                member=member,
                availability=member.soft_preference(query.service_date),
                on_duty_that_day=member.id in on_duty,
                slots=tuple(moves),
                blocking_violations=tuple(blocking),
                rule_violations=tuple(to_acknowledge),
                warning_violations=tuple(warnings),
                next_step=translate("swaps.blocked_next_step") if blocking else None,
            )
        )
    return options


async def preview_swap_impact(query: SwapImpactQuery, ports: SwapPorts) -> SwapImpact:
    """What the swap would do to both people's balance; nothing is written.

    Measured in the same 12-month window as the fairness report, so the
    preview and the report never disagree.
    """
    if query.actor.role == UserRole.viewer:
        raise PointsHiddenFromViewers()
    replacement = await ports.team.member(query.replacement_member_id)
    if replacement is None:
        raise ReplacementNotFound()
    publication = await ports.roster.latest_publication_covering(query.service_date)
    if publication is None:
        raise NoPublicationForDay()
    current = await ports.roster.duty(publication.id, (query.service_date, query.role))
    if current is None:
        raise SlotHasNoPublishedDuty()
    requester = (
        await ports.team.member(current.member_id) if current.member_id is not None else None
    )
    if requester is None and current.member_id is None:
        requester = await ports.team.member_named(current.assignee_name)
    if requester is None:
        raise SlotHolderNotATeamMember()
    # A member may only preview a slot they are part of.
    if not query.actor.coordinates:
        own = await _member_for(query.actor, ports.team)
        if own.id not in (requester.id, replacement.id):
            raise OnlyOwnSwapsPreview()

    # The window ends on the service date so the duty being moved is inside it.
    window_start, window_end = window(query.service_date)
    members, duties = await ports.fairness.balance_inputs(window_start, window_end)
    polish_days = polish_holidays(window_start, window_end)
    projected_duties = reassign(
        duties,
        query.service_date,
        query.role,
        requester.display_name,
        replacement.display_name,
        replacement.id,
    )
    # A request on the anchor role (or on 11-19 itself) moves both slots as one
    # decision (decision D1); checking only the clicked slot would make a
    # tolerated anchor split look like a fresh rule break.
    context_start, context_end = rule_window([query.service_date])
    in_force = await ports.roster.duties_in_force(context_start, context_end)
    anchor = await ports.policy.late_shift_anchor()
    moves, _anchor_exception = moves_for(
        service_date=query.service_date,
        role=query.role,
        requester=requester,
        replacement=replacement,
        duties=in_force,
        anchor=anchor,
        holidays=polish_holidays(context_start, context_end),
    )
    # Every violation the move set creates, blocking or merely tolerated: the
    # preview has no submit gate of its own to hide a blocking one behind.
    impact_warnings = await substitution_check(
        ports.roster, ports.policy, moves, requester.display_name, replacement.display_name
    )
    before = compute_fairness(
        members, duties, holidays=polish_days, window_start=window_start, window_end=window_end
    )
    after = compute_fairness(
        members,
        projected_duties,
        holidays=polish_days,
        window_start=window_start,
        window_end=window_end,
    )
    by_id_before = {item.member_id: item for item in before.members}
    by_id_after = {item.member_id: item for item in after.members}

    def side(member: Member) -> SwapImpactSide:
        balance_before: MemberBalance | None = by_id_before.get(member.id)
        balance_after: MemberBalance | None = by_id_after.get(member.id)
        if balance_before is None or balance_after is None:
            raise NoBalanceInWindow(member.display_name)
        return SwapImpactSide(
            member_id=member.id,
            display_name=member.display_name,
            before=balance_before,
            after=balance_after,
        )

    requester_side = side(requester)
    replacement_side = side(replacement)
    return SwapImpact(
        service_date=query.service_date,
        role=query.role,
        points=day_weight(query.service_date, polish_days),
        window_start=window_start,
        window_end=window_end,
        requester=requester_side,
        replacement=replacement_side,
        warnings=tuple(impact_warnings),
    )


async def swap_policy(ports: SwapPorts) -> SwapPolicy:
    """How far a request travels: to a coordinator, or straight into the
    schedule once the replacement agrees."""
    return SwapPolicy(
        coordinator_approval_required=await ports.policy.coordinator_swap_approval_required()
    )


async def list_swap_requests(query: SwapListQuery, ports: SwapPorts) -> list[SwapRequestView]:
    """Newest first. Members see the requests they take part in; coordinators
    see every request.

    A request still open is read against the roster as it is now, so whoever
    decides on it sees the rules it would break today, not the ones it broke
    when it was filed.
    """
    involving = None
    if not query.actor.coordinates:
        involving = (await _member_for(query.actor, ports.team)).id
    requests = await ports.requests.requests(
        involving=involving, statuses=query.statuses, limit=query.limit, offset=query.offset
    )
    names = await ports.team.display_names(
        {
            member_id
            for request in requests
            for member_id in (request.requester_member_id, request.replacement_member_id)
        }
    )
    views = [
        _named(request, names[request.requester_member_id], names[request.replacement_member_id])
        for request in requests
    ]
    open_requests = [request for request in requests if request.active]
    if not open_requests:
        return views
    tiers = await _rule_tiers(open_requests, ports)

    def as_it_stands(view: SwapRequestView) -> SwapRequestView:
        _refusing, to_acknowledge, warnings = tiers(
            view.request, view.requester_name, view.replacement_name
        )
        return replace(view, warnings=tuple(warnings), rule_violations=tuple(to_acknowledge))

    return [as_it_stands(view) if view.request.active else view for view in views]


async def request_swap(
    swap: SwapRequestInput, ports: SwapPorts, *, today: date | None = None
) -> SwapRequestView:
    """Ask a colleague to take over a published duty of one's own."""
    if swap.service_date < (today or business_today()):
        raise SwapInThePast()
    requester = await _member_for(swap.actor, ports.team)
    # Which schedule owns the slot is resolved here, never taken from the
    # caller: once a shorter range is republished inside a longer one both are
    # published, and only the roster in force knows which one holds the day.
    window_start, window_end = rule_window([swap.service_date])
    duties = await ports.roster.duties_in_force(window_start, window_end)
    anchor = await ports.policy.late_shift_anchor()
    holidays = polish_holidays(window_start, window_end)
    in_force = duties.get((swap.service_date, swap.role))
    if in_force is None:
        raise SlotNotPublished()
    schedule = await ports.roster.schedule(in_force.schedule_id)
    if schedule is None or not schedule.published:
        raise SlotNotPublished()
    if not in_force.held_by(requester.id, requester.display_name):
        raise SlotNotYours()
    replacement = await ports.team.member(swap.replacement_member_id)
    if replacement is None or not replacement.is_eligible(swap.role, swap.service_date):
        raise ReplacementNotEligible()
    if replacement.id == requester.id:
        raise CannotSwapWithYourself()
    if not replacement.has_account:
        raise ReplacementHasNoAccount()
    if replacement.is_unavailable(swap.service_date):
        raise ReplacementUnavailable()

    # A swap of the anchor role or of 11-19 carries both slots of that day as
    # one decision (decision D1); if the replacement cannot hold 11-19 the shift
    # stays put and the anchor split is a tolerated exception.
    moves, anchor_exception = moves_for(
        service_date=swap.service_date,
        role=swap.role,
        requester=requester,
        replacement=replacement,
        duties=duties,
        anchor=anchor,
        holidays=holidays,
    )
    for move in moves:
        if await _takes_opposite_oncall(ports.roster, schedule.id, move, replacement):
            raise ReplacementAlreadyOnCall()
        if await ports.requests.has_active_request_for(move):
            raise SlotHasActiveSwap()

    # Up-front validation (decision D3): a request no decision could let
    # through must not come into existence at all. `day_off_block` and the
    # anchor exception only warn (decisions D1, D2).
    violations = substitution_violations(
        holder_names(duties),
        moves,
        requester.display_name,
        replacement.display_name,
        anchor,
        holidays,
        await ports.policy.rotation_mode(),
    )
    blocking, to_acknowledge, warnings = partition_violations(
        violations, anchor_exception=anchor_exception
    )
    if blocking:
        raise SwapBreaksHardRules(blocking)
    # A member may ask for what a coordinator's correction may do: break a
    # rest or anchor rule knowingly. Asking takes having seen the violations
    # and saying why; the replacement, and a coordinator where the policy asks
    # for one, acknowledge them again when they decide.
    if to_acknowledge:
        if not swap.acknowledge_rule_violations:
            raise SwapRuleViolationsNotAcknowledged(to_acknowledge)
        if len((swap.note or "").strip()) < MIN_REASON_LENGTH:
            raise RuleBreakingSwapNeedsReason()
    request = await ports.requests.add(
        NewSwapRequest(
            schedule_id=schedule.id,
            service_date=swap.service_date,
            role=swap.role,
            requester_member_id=requester.id,
            replacement_member_id=replacement.id,
            schedule_version=schedule.version,
            note=swap.note,
            slots=tuple(moves),
            rule_violations=acknowledged_violations(
                to_acknowledge, requester_name=requester.display_name
            ),
        )
    )
    await ports.journal.requested(
        request,
        requester_name=requester.display_name,
        replacement_name=replacement.display_name,
        warnings=warnings,
        violations=to_acknowledge,
    )
    return replace(
        _named(request, requester.display_name, replacement.display_name),
        warnings=tuple(warnings),
    )


async def accept_swap(
    decision: SwapDecisionInput, ports: SwapPorts, *, today: date | None = None
) -> SwapRequestView | SwapAutoCancelled:
    """The named replacement agrees.

    The request then goes to a coordinator, or, when the policy asks for no
    coordinator's approval, straight into the schedule: the acceptance is then
    the hand-over, with the same checks and the same outcomes as an approval.
    Either way a hard rule the swap breaks on the roster as it is now has to
    be acknowledged here: the replacement is usually the one whose rest it
    cuts into.
    """
    member = await _member_for(decision.actor, ports.team)
    request = await ports.requests.take_for_decision(decision.swap_id)
    if request is None:
        raise SwapNotFound()
    if request.replacement_member_id != member.id:
        raise OnlyNamedReplacementMayAccept()
    if request.status != SwapStatus.pending_replacement:
        raise SwapNotAwaitingReplacement()
    _reject_past(request, today or business_today())
    requester = await ports.team.member(request.requester_member_id)
    if requester is None:
        raise SwapPartiesGone()
    if await ports.policy.coordinator_swap_approval_required():
        # A rule that refuses the swap outright is left to the approval,
        # which answers for the hand-over.
        tiers = await _rule_tiers([request], ports)
        _refusing, to_acknowledge, _warnings = tiers(
            request, requester.display_name, member.display_name
        )
        if to_acknowledge and not decision.acknowledge_rule_violations:
            raise SwapRuleViolationsNotAcknowledged(to_acknowledge)
        accepted = replace(
            request,
            status=SwapStatus.pending_coordinator,
            rule_violations=acknowledged_violations(
                to_acknowledge, requester_name=requester.display_name
            ),
        )
        await ports.requests.record_decision(accepted)
        await ports.journal.accepted(
            accepted,
            requester_name=requester.display_name,
            replacement_name=member.display_name,
            violations=to_acknowledge,
        )
        return _named(accepted, requester.display_name, member.display_name)
    return await _hand_over(
        request,
        ports,
        requester=requester,
        replacement=member,
        by_coordinator=False,
        self_approved=False,
        acknowledged=decision.acknowledge_rule_violations,
    )


async def reject_swap(decision: SwapDecisionInput, ports: SwapPorts) -> SwapRequestView:
    """The replacement declines, or a coordinator turns an accepted request down."""
    _require_reason(decision.reason)
    request = await ports.requests.take_for_decision(decision.swap_id)
    if request is None:
        raise SwapNotFound()
    if request.status == SwapStatus.pending_replacement:
        member = await _member_for(decision.actor, ports.team)
        if request.replacement_member_id != member.id:
            raise OnlyNamedReplacementMayReject()
    elif request.status == SwapStatus.pending_coordinator:
        if not decision.actor.coordinates:
            raise OnlyCoordinatorMayRejectAccepted()
    else:
        raise SwapNoLongerRejectable()
    by_coordinator = request.status == SwapStatus.pending_coordinator
    rejected = replace(request, status=SwapStatus.rejected, decision_note=decision.reason)
    await ports.requests.record_decision(rejected)
    view = await _view(rejected, ports.team)
    await ports.journal.rejected(
        rejected,
        requester_name=view.requester_name,
        replacement_name=view.replacement_name,
        reason=decision.reason,
        by_coordinator=by_coordinator,
    )
    return view


async def cancel_swap(decision: SwapDecisionInput, ports: SwapPorts) -> SwapRequestView:
    """The requester withdraws a request nobody has decided on yet."""
    _require_reason(decision.reason)
    member = await _member_for(decision.actor, ports.team)
    request = await ports.requests.take_for_decision(decision.swap_id)
    if request is None:
        raise SwapNotFound()
    if request.requester_member_id != member.id:
        raise OnlyRequesterMayCancel()
    if not request.active:
        raise SwapNoLongerCancellable()
    cancelled = replace(request, status=SwapStatus.cancelled, decision_note=decision.reason)
    await ports.requests.record_decision(cancelled)
    view = await _view(cancelled, ports.team)
    await ports.journal.cancelled(
        cancelled,
        requester_name=view.requester_name,
        replacement_name=view.replacement_name,
        reason=decision.reason,
    )
    return view


async def approve_swap(
    decision: SwapDecisionInput, ports: SwapPorts, *, today: date | None = None
) -> SwapRequestView | SwapAutoCancelled:
    """A coordinator hands the slots over to the replacement.

    Returns `SwapAutoCancelled` when a slot changed owner since the request:
    the request is then cancelled, and that cancellation is meant to be kept.
    """
    request = await ports.requests.take_for_decision(decision.swap_id)
    if request is None:
        raise SwapNotFound()
    if request.status != SwapStatus.pending_coordinator:
        raise SwapNotAwaitingCoordinator()
    _reject_past(request, today or business_today())
    requester = await ports.team.member(request.requester_member_id)
    replacement = await ports.team.member(request.replacement_member_id)
    if replacement is None or requester is None:
        raise SwapPartiesGone()
    self_approved = decision.actor.user_id in (requester.user_id, replacement.user_id)
    if self_approved and await ports.team.another_active_approver_exists(decision.actor.user_id):
        raise SelfApprovalNotAllowed()
    return await _hand_over(
        request,
        ports,
        requester=requester,
        replacement=replacement,
        by_coordinator=True,
        self_approved=self_approved,
        acknowledged=decision.acknowledge_rule_violations,
    )


async def _hand_over(
    request: SwapRequest,
    ports: SwapPorts,
    *,
    requester: Member,
    replacement: Member,
    by_coordinator: bool,
    self_approved: bool,
    acknowledged: bool,
) -> SwapRequestView | SwapAutoCancelled:
    """Write the swap into the schedule: the deciding checks against the
    roster as it is now, the version step, the hand-over of every slot and
    the approved transition. Shared by the coordinator's approval and by an
    acceptance the policy lets stand on its own; `acknowledged` is that
    person's word that they have seen the hard rules the swap breaks.

    Returns `SwapAutoCancelled` when a slot changed owner since the request:
    the request is then cancelled, and that cancellation is meant to be kept.
    """
    moves = request.moves
    for move in moves:
        duty = await ports.roster.duty_for_handover(request.schedule_id, move)
        if duty is None:
            raise SwapPartiesGone()
        # Only the concrete slot matters. Unrelated swaps and overrides may
        # advance the schedule version without invalidating this request.
        slot_still_owned = duty.member_id == request.requester_member_id or (
            duty.member_id is None and duty.assignee_name == requester.display_name
        )
        if not slot_still_owned:
            await ports.requests.record_decision(
                replace(request, status=SwapStatus.cancelled, decision_note=SLOT_CHANGED_OWNER_NOTE)
            )
            return SwapAutoCancelled(request.id)
        if await _takes_opposite_oncall(ports.roster, request.schedule_id, move, replacement):
            raise ReplacementOnCallSinceRequest()

    # Deciding validation (decision D3): the roster may have moved between the
    # request and the hand-over, so the hard rules are checked again here and
    # acknowledged by whoever decides now.
    tiers = await _rule_tiers([request], ports)
    blocking, to_acknowledge, _warnings = tiers(
        request, requester.display_name, replacement.display_name
    )
    if blocking:
        raise SwapBreaksHardRules(blocking)
    if to_acknowledge and not acknowledged:
        raise SwapRuleViolationsNotAcknowledged(to_acknowledge)
    if not await ports.roster.advance_version(
        request.schedule_id, expected_version=None, only_if_published=True
    ):
        raise ScheduleChangedSinceRequest()
    await ports.roster.hand_over(request.schedule_id, moves, replacement)
    approved = replace(
        request,
        status=SwapStatus.approved,
        rule_violations=acknowledged_violations(
            to_acknowledge, requester_name=requester.display_name
        ),
    )
    await ports.requests.record_decision(approved)
    await ports.journal.approved(
        approved,
        requester_name=requester.display_name,
        replacement_name=replacement.display_name,
        by_coordinator=by_coordinator,
        self_approved=self_approved,
        violations=to_acknowledge,
    )
    return _named(approved, requester.display_name, replacement.display_name)
