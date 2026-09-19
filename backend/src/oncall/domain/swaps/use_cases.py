"""Swap use cases.

The order of the checks is part of the behaviour: when a request is wrong in
two ways, the first failing rule is the one the person is told about.
"""

from dataclasses import replace
from datetime import date

from oncall.domain.clock import business_today
from oncall.domain.errors import NotATeamMember
from oncall.domain.hard_rules import substitution_check
from oncall.domain.ports import PublishedRoster, TeamDirectory
from oncall.domain.roster import OPPOSITE_ONCALL, Slot, holder_names, rule_window
from oncall.domain.swaps.coupling import (
    has_anchor_exception,
    moves_for,
    partition_violations,
    takes_second_oncall,
)
from oncall.domain.swaps.errors import (
    BLOCKED_NEXT_STEP,
    SLOT_CHANGED_OWNER_NOTE,
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
)
from oncall.domain.swaps.models import (
    NewSwapRequest,
    ReplacementOption,
    ReplacementOptionsQuery,
    SwapAutoCancelled,
    SwapDecisionInput,
    SwapImpact,
    SwapImpactQuery,
    SwapImpactSide,
    SwapListQuery,
    SwapRequest,
    SwapRequestInput,
    SwapRequestView,
)
from oncall.domain.swaps.ports import SwapPorts
from oncall.domain.team import Actor, Member
from oncall.domain.vocabulary import SwapStatus, UserRole
from oncall.fairness import MemberBalance, compute_fairness, day_weight, reassign, window
from oncall.rules import RuleViolation, substitution_violations
from oncall.workdays import polish_holidays


async def _member_for(actor: Actor, team: TeamDirectory) -> Member:
    member = await team.member_for_account(actor.user_id)
    if member is None:
        raise NotATeamMember()
    return member


async def _takes_opposite_oncall(
    roster: PublishedRoster, schedule_id, move: Slot, replacement: Member
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
        raise SwapInThePast(request.service_date)


def _require_reason(reason: str | None) -> None:
    if reason is None or not reason.strip():
        raise DecisionReasonRequired()


async def _view(request: SwapRequest, team: TeamDirectory) -> SwapRequestView:
    names = await team.display_names((request.requester_member_id, request.replacement_member_id))
    return SwapRequestView(
        request=request,
        requester_name=names[request.requester_member_id],
        replacement_name=names[request.replacement_member_id],
    )


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
            holders, moves, requester.display_name, member.display_name, anchor, holidays
        )
        blocking, warnings = partition_violations(violations, anchor_exception=anchor_exception)
        # A coupled swap can hand the candidate a second on-call role the
        # clicked-slot filter never saw; `request_swap` refuses that, so the
        # option must say so rather than be offered and then refused.
        if takes_second_oncall(duties, moves, member):
            blocking.append(
                RuleViolation(
                    "double_oncall",
                    "Zastępca ma już drugi dyżur on-call tego dnia.",
                    member.display_name,
                    (query.service_date,),
                )
            )
        options.append(
            ReplacementOption(
                member=member,
                availability=member.soft_preference(query.service_date),
                on_duty_that_day=member.id in on_duty,
                slots=tuple(moves),
                blocking_violations=tuple(blocking),
                warning_violations=tuple(warnings),
                next_step=BLOCKED_NEXT_STEP if blocking else None,
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
        raise ReplacementNotFound(query.replacement_member_id)
    publication = await ports.roster.latest_publication_covering(query.service_date)
    if publication is None:
        raise NoPublicationForDay(query.service_date)
    current = await ports.roster.duty(publication.id, (query.service_date, query.role))
    if current is None:
        raise SlotHasNoPublishedDuty(query.service_date)
    requester = (
        await ports.team.member(current.member_id) if current.member_id is not None else None
    )
    if requester is None and current.member_id is None:
        requester = await ports.team.member_named(current.assignee_name)
    if requester is None:
        raise SlotHolderNotATeamMember(current.assignee_name)
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


async def list_swap_requests(query: SwapListQuery, ports: SwapPorts) -> list[SwapRequestView]:
    """Newest first. Members see the requests they take part in; coordinators
    see every request."""
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
    return [
        SwapRequestView(
            request=request,
            requester_name=names[request.requester_member_id],
            replacement_name=names[request.replacement_member_id],
        )
        for request in requests
    ]


async def request_swap(
    swap: SwapRequestInput, ports: SwapPorts, *, today: date | None = None
) -> SwapRequestView:
    """Ask a colleague to take over a published duty of one's own."""
    if swap.service_date < (today or business_today()):
        raise SwapInThePast(swap.service_date)
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
        raise SlotNotPublished(swap.service_date)
    schedule = await ports.roster.schedule(in_force.schedule_id)
    if schedule is None or not schedule.published:
        raise SlotNotPublished(swap.service_date)
    if not in_force.held_by(requester.id, requester.display_name):
        raise SlotNotYours()
    replacement = await ports.team.member(swap.replacement_member_id)
    if replacement is None or not replacement.is_eligible(swap.role, swap.service_date):
        raise ReplacementNotEligible(swap.replacement_member_id)
    if replacement.id == requester.id:
        raise CannotSwapWithYourself()
    if not replacement.has_account:
        raise ReplacementHasNoAccount(replacement.id)
    if replacement.is_unavailable(swap.service_date):
        raise ReplacementUnavailable(replacement.id, swap.service_date)

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
            raise ReplacementAlreadyOnCall(move[0])
        if await ports.requests.has_active_request_for(move):
            raise SlotHasActiveSwap(move[0])

    # Up-front validation (decision D3): a request that would be rejected at
    # approval must not come into existence at all. `day_off_block` and the
    # anchor exception only warn (decisions D1, D2).
    violations = substitution_violations(
        holder_names(duties),
        moves,
        requester.display_name,
        replacement.display_name,
        anchor,
        holidays,
    )
    blocking, warnings = partition_violations(violations, anchor_exception=anchor_exception)
    if blocking:
        raise SwapBreaksHardRules(blocking)
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
        )
    )
    await ports.journal.requested(
        request,
        requester_name=requester.display_name,
        replacement_name=replacement.display_name,
        warnings=warnings,
    )
    return SwapRequestView(
        request=request,
        requester_name=requester.display_name,
        replacement_name=replacement.display_name,
        warnings=tuple(warnings),
    )


async def accept_swap(
    decision: SwapDecisionInput, ports: SwapPorts, *, today: date | None = None
) -> SwapRequestView:
    """The named replacement agrees; the request goes to a coordinator."""
    member = await _member_for(decision.actor, ports.team)
    request = await ports.requests.take_for_decision(decision.swap_id)
    if request is None:
        raise SwapNotFound(decision.swap_id)
    if request.replacement_member_id != member.id:
        raise OnlyNamedReplacementMayAccept()
    if request.status != SwapStatus.pending_replacement:
        raise SwapNotAwaitingReplacement()
    _reject_past(request, today or business_today())
    accepted = replace(request, status=SwapStatus.pending_coordinator)
    await ports.requests.record_decision(accepted)
    view = await _view(accepted, ports.team)
    await ports.journal.accepted(
        accepted, requester_name=view.requester_name, replacement_name=view.replacement_name
    )
    return view


async def reject_swap(decision: SwapDecisionInput, ports: SwapPorts) -> SwapRequestView:
    """The replacement declines, or a coordinator turns an accepted request down."""
    _require_reason(decision.reason)
    request = await ports.requests.take_for_decision(decision.swap_id)
    if request is None:
        raise SwapNotFound(decision.swap_id)
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
        raise SwapNotFound(decision.swap_id)
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
        raise SwapNotFound(decision.swap_id)
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

    moves = request.moves
    window_start, window_end = rule_window([request.service_date])
    anchor = await ports.policy.late_shift_anchor()
    anchor_exception = has_anchor_exception(
        moves, anchor, polish_holidays(window_start, window_end)
    )
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
            raise ReplacementOnCallSinceRequest(move[0])

    # Deciding validation (decision D3): the roster may have moved between the
    # request and the approval, so the hard rules are checked again here.
    violations = await substitution_check(
        ports.roster, ports.policy, moves, requester.display_name, replacement.display_name
    )
    blocking, _warnings = partition_violations(violations, anchor_exception=anchor_exception)
    if blocking:
        raise SwapBreaksHardRules(blocking)
    if not await ports.roster.advance_version(
        request.schedule_id, expected_version=None, only_if_published=True
    ):
        raise ScheduleChangedSinceRequest(request.schedule_id)
    await ports.roster.hand_over(request.schedule_id, moves, replacement)
    approved = replace(request, status=SwapStatus.approved)
    await ports.requests.record_decision(approved)
    view = await _view(approved, ports.team)
    await ports.journal.approved(
        approved,
        requester_name=view.requester_name,
        replacement_name=view.replacement_name,
        self_approved=self_approved,
    )
    return view
