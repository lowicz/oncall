"""Swap use cases.

The order of the checks is part of the behaviour: when a request is wrong in
two ways, the first failing rule is the one the person is told about.
"""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass, replace
from datetime import date

from oncall.domain.clock import business_today
from oncall.domain.errors import NotATeamMember
from oncall.domain.overrides.models import MIN_REASON_LENGTH
from oncall.domain.ports import PublishedRoster, TeamDirectory
from oncall.domain.roster import (
    OPPOSITE_ONCALL,
    Duty,
    ScheduleRef,
    Slot,
    holder_names,
    rule_window,
)
from oncall.domain.swaps.coupling import (
    anchor_exception_days,
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
    RequesterNotEligible,
    RequesterUnavailable,
    ReturnOnTheSameDay,
    ReturnSlotNotTheirs,
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
    RETURN_HORIZON,
    SLOT_CHANGED_OWNER_NOTE,
    NewSwapRequest,
    ReplacementOption,
    ReplacementOptionsQuery,
    ReturnOption,
    ReturnOptionsQuery,
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
    SwapReturn,
    acknowledged_violations,
)
from oncall.domain.swaps.ports import SwapPorts
from oncall.domain.team import Actor, Member
from oncall.domain.vocabulary import (
    AssignmentRole,
    LateShiftAnchor,
    RotationMode,
    SwapStatus,
    UserRole,
)
from oncall.fairness import MemberBalance, compute_fairness, day_weight, reassign, window
from oncall.i18n import translate
from oncall.rules import RuleViolation, batch_substitution_violations
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
    """An exchange is one decision: once the earlier of its days has passed,
    neither half can be decided on."""
    if any(day < today for day, _role in request.all_moves):
        raise SwapInThePast()


def _require_reason(reason: str | None) -> None:
    if reason is None or not reason.strip():
        raise DecisionReasonRequired()


def _named(
    request: SwapRequest,
    requester_name: str,
    replacement_name: str,
    warnings: Sequence[RuleViolation] = (),
) -> SwapRequestView:
    """The request as a person reads it, with the violations it keeps."""
    return SwapRequestView(
        request=request,
        requester_name=requester_name,
        replacement_name=replacement_name,
        warnings=tuple(warnings),
        rule_violations=request.named_violations(requester_name, replacement_name),
    )


async def _view(request: SwapRequest, team: TeamDirectory) -> SwapRequestView:
    names = await team.display_names((request.requester_member_id, request.replacement_member_id))
    return _named(request, names[request.requester_member_id], names[request.replacement_member_id])


#: The rules a swap is refused by, the ones it breaks only with an
#: acknowledgement and the ones it bends (`partition_violations`).
RuleTiers = tuple[list[RuleViolation], list[RuleViolation], list[RuleViolation]]


@dataclass(frozen=True)
class _Roster:
    """What every check of a swap is made against: the duties in force around
    the days it touches, and the policy the hard rules are read under."""

    duties: dict[Slot, Duty]
    anchor: LateShiftAnchor
    mode: RotationMode
    holidays: set[date]

    def moves(self, slot: Slot, giver: Member, taker: Member) -> tuple[list[Slot], bool]:
        """The slots that leave `giver` when `taker` takes this one, and
        whether 11-19 stays behind as the tolerated anchor exception."""
        service_date, role = slot
        return moves_for(
            service_date=service_date,
            role=role,
            requester=giver,
            replacement=taker,
            duties=self.duties,
            anchor=self.anchor,
            holidays=self.holidays,
        )

    def tiers(
        self,
        given: list[Slot],
        returned: list[Slot],
        requester_name: str,
        replacement_name: str,
        exception_days: set[date],
    ) -> RuleTiers:
        """How the swap stands against the hard rules, both directions
        checked as one batch: the half an exchange gives away is often a
        violation the half it takes back undoes."""
        violations = batch_substitution_violations(
            holder_names(self.duties),
            [(day, role, replacement_name) for day, role in given]
            + [(day, role, requester_name) for day, role in returned],
            self.anchor,
            self.holidays,
            self.mode,
            names={requester_name, replacement_name},
        )
        return partition_violations(violations, anchor_exception_days=exception_days)

    def standing(
        self, request: SwapRequest, requester_name: str, replacement_name: str
    ) -> RuleTiers:
        """`tiers` for a stored request, on this roster as it is now."""
        return self.tiers(
            request.moves,
            request.return_moves,
            requester_name,
            replacement_name,
            anchor_exception_days(request.all_moves, self.anchor, self.holidays),
        )


async def _roster_around(days: list[date], ports: SwapPorts) -> _Roster:
    """One read of the roster in force covers every rule window of `days`."""
    window_start, window_end = rule_window(days)
    return _Roster(
        duties=await ports.roster.duties_in_force(window_start, window_end),
        anchor=await ports.policy.late_shift_anchor(),
        mode=await ports.policy.rotation_mode(),
        holidays=polish_holidays(window_start, window_end),
    )


async def _published_duty(
    slot: Slot, roster: _Roster, published: PublishedRoster
) -> tuple[Duty, ScheduleRef]:
    """The duty in force on a slot and the published schedule that holds it.

    Which schedule owns the slot is resolved here, never taken from the
    caller: once a shorter range is republished inside a longer one both are
    published, and only the roster in force knows which one holds the day.
    """
    in_force = roster.duties.get(slot)
    if in_force is None:
        raise SlotNotPublished()
    schedule = await published.schedule(in_force.schedule_id)
    if schedule is None or not schedule.published:
        raise SlotNotPublished()
    return in_force, schedule


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
    roster = await _roster_around([query.service_date], ports)
    on_duty = {
        duty.member_id
        for (day, _role), duty in roster.duties.items()
        if day == query.service_date and duty.member_id is not None
    }
    options: list[ReplacementOption] = []
    for member in offered:
        moves, anchor_exception = roster.moves((query.service_date, query.role), requester, member)
        blocking, to_acknowledge, warnings = roster.tiers(
            moves,
            [],
            requester.display_name,
            member.display_name,
            {query.service_date} if anchor_exception else set(),
        )
        # A coupled swap can hand the candidate a second on-call role the
        # clicked-slot filter never saw; `request_swap` refuses that, so the
        # option must say so rather than be offered and then refused.
        if takes_second_oncall(roster.duties, moves, member):
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


async def list_return_options(
    query: ReturnOptionsQuery, ports: SwapPorts, *, today: date | None = None
) -> list[ReturnOption]:
    """The replacement's coming duties the requester could take in exchange
    for the one given away, each with what the whole exchange would break or
    bend. The ones that break nothing come first: handing a duty over adds
    one to the replacement's week, an exchange only moves it."""
    today = today or business_today()
    if query.service_date < today:
        return []
    requester = await _member_for(query.actor, ports.team)
    replacement = await ports.team.member(query.replacement_member_id)
    if replacement is None:
        raise ReplacementNotFound()
    horizon = today + RETURN_HORIZON
    roster = await _roster_around([today, query.service_date, horizon], ports)
    given, given_exception = roster.moves((query.service_date, query.role), requester, replacement)
    options: dict[frozenset[Slot], ReturnOption] = {}
    # The on-call role of a day before its 11-19: a pair that travels together
    # is offered once, under the role that names the duty.
    for slot in sorted(
        roster.duties, key=lambda slot: (slot[0], slot[1] == AssignmentRole.late_shift)
    ):
        day, role = slot
        if (
            not today <= day <= horizon
            or day == query.service_date
            or not roster.duties[slot].held_by(replacement.id, replacement.display_name)
            or not requester.is_eligible(role, day)
            or requester.is_unavailable(day)
        ):
            continue
        returned, return_exception = roster.moves(slot, replacement, requester)
        if frozenset(returned) in options:
            continue
        blocking, to_acknowledge, warnings = roster.tiers(
            given,
            returned,
            requester.display_name,
            replacement.display_name,
            ({query.service_date} if given_exception else set())
            | ({day} if return_exception else set()),
        )
        options[frozenset(returned)] = ReturnOption(
            service_date=day,
            role=role,
            slots=tuple(returned),
            blocking_violations=tuple(blocking),
            rule_violations=tuple(to_acknowledge),
            warning_violations=tuple(warnings),
        )
    return sorted(
        options.values(),
        key=lambda option: (
            bool(option.blocking_violations),
            bool(option.rule_violations),
            bool(option.warning_violations),
            option.service_date,
        ),
    )


async def preview_swap_impact(query: SwapImpactQuery, ports: SwapPorts) -> SwapImpact:
    """What the swap would do to both people's balance; nothing is written.

    Every slot the swap moves is projected: the 11-19 slot that travels with
    its role and, in an exchange, the duty that comes back. Measured in the
    same 12-month window as the fairness report, so the preview and the report
    never disagree.
    """
    if query.actor.role == UserRole.viewer:
        raise PointsHiddenFromViewers()
    replacement = await ports.team.member(query.replacement_member_id)
    if replacement is None:
        raise ReplacementNotFound()
    publication = await ports.roster.latest_publication_covering(query.service_date)
    if publication is None:
        raise NoPublicationForDay()
    slot = (query.service_date, query.role)
    current = await ports.roster.duty(publication.id, slot)
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

    days = [query.service_date] + ([query.in_return[0]] if query.in_return is not None else [])
    roster = await _roster_around(days, ports)
    # A correction carries 11-19 along only from its anchor role
    # (`override_duty`); a swap couples the pair from either slot.
    if query.correction and query.role == AssignmentRole.late_shift:
        given = [slot]
    else:
        given, _exception = roster.moves(slot, requester, replacement)
    moved = [(move, requester, replacement) for move in given]
    if query.in_return is not None:
        returned, _exception = roster.moves(query.in_return, replacement, requester)
        moved += [(move, replacement, requester) for move in returned]

    # The window ends on the last moved day so every moved duty is inside it.
    window_start, window_end = window(max(days))
    members, duties = await ports.fairness.balance_inputs(window_start, window_end)
    polish_days = polish_holidays(window_start, window_end)
    projected_duties = duties
    for (day, role), giver, taker in moved:
        projected_duties = reassign(
            projected_duties, day, role, giver.display_name, taker.display_name, taker.id
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
        return_date=query.in_return[0] if query.in_return is not None else None,
        return_points=(
            day_weight(query.in_return[0], polish_days) if query.in_return is not None else None
        ),
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
    # One read of the roster covers all of them.
    roster = await _roster_around(
        [day for request in open_requests for day, _role in request.all_moves], ports
    )

    def as_it_stands(view: SwapRequestView) -> SwapRequestView:
        _refusing, to_acknowledge, warnings = roster.standing(
            view.request, view.requester_name, view.replacement_name
        )
        return SwapRequestView(
            request=view.request,
            requester_name=view.requester_name,
            replacement_name=view.replacement_name,
            warnings=tuple(warnings),
            rule_violations=tuple(to_acknowledge),
        )

    return [as_it_stands(view) if view.request.active else view for view in views]


async def _duty_in_return(
    slot: Slot,
    given_day: date,
    requester: Member,
    replacement: Member,
    roster: _Roster,
    published: PublishedRoster,
) -> tuple[SwapReturn, bool]:
    """The replacement's duty the requester asks for in exchange, checked the
    way the duty given away is, with the two people in each other's place.
    Also whether its 11-19 stays behind as the tolerated anchor exception."""
    day, role = slot
    if day == given_day:
        raise ReturnOnTheSameDay()
    in_force, schedule = await _published_duty(slot, roster, published)
    if not in_force.held_by(replacement.id, replacement.display_name):
        raise ReturnSlotNotTheirs()
    if not requester.is_eligible(role, day):
        raise RequesterNotEligible()
    if requester.is_unavailable(day):
        raise RequesterUnavailable()
    moves, anchor_exception = roster.moves(slot, replacement, requester)
    return SwapReturn(schedule.id, tuple(moves)), anchor_exception


async def request_swap(
    swap: SwapRequestInput, ports: SwapPorts, *, today: date | None = None
) -> SwapRequestView:
    """Ask a colleague to take over a published duty of one's own, and
    optionally to give one of theirs in exchange."""
    days = [swap.service_date] + ([swap.in_return[0]] if swap.in_return is not None else [])
    if min(days) < (today or business_today()):
        raise SwapInThePast()
    requester = await _member_for(swap.actor, ports.team)
    roster = await _roster_around(days, ports)
    slot = (swap.service_date, swap.role)
    in_force, schedule = await _published_duty(slot, roster, ports.roster)
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
    moves, anchor_exception = roster.moves(slot, requester, replacement)
    exception_days = {swap.service_date} if anchor_exception else set()
    in_return = None
    if swap.in_return is not None:
        in_return, return_exception = await _duty_in_return(
            swap.in_return, swap.service_date, requester, replacement, roster, ports.roster
        )
        if return_exception:
            exception_days.add(swap.in_return[0])
    for move in moves:
        if await _takes_opposite_oncall(ports.roster, schedule.id, move, replacement):
            raise ReplacementAlreadyOnCall()
    returned = list(in_return.slots) if in_return is not None else []
    # In date order, so two requests that cross each other's days wait for
    # one another instead of each holding the day the other needs.
    for move in sorted(moves + returned):
        if await ports.requests.has_active_request_for(move):
            raise SlotHasActiveSwap()

    # Up-front validation (decision D3): a request no decision could let
    # through must not come into existence at all. `day_off_block` and the
    # anchor exception only warn (decisions D1, D2). The requester ending up
    # with both on-call roles on the day taken in return is one of the rules
    # that refuse it here.
    blocking, to_acknowledge, warnings = roster.tiers(
        moves, returned, requester.display_name, replacement.display_name, exception_days
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
            in_return=in_return,
        )
    )
    await ports.journal.requested(
        request,
        requester_name=requester.display_name,
        replacement_name=replacement.display_name,
        warnings=warnings,
        violations=to_acknowledge,
    )
    return _named(request, requester.display_name, replacement.display_name, warnings)


async def accept_swap(
    decision: SwapDecisionInput, ports: SwapPorts, *, today: date | None = None
) -> SwapRequestView | SwapAutoCancelled:
    """The named replacement agrees; one acceptance covers both directions of
    an exchange.

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
        roster = await _roster_around([day for day, _role in request.all_moves], ports)
        _refusing, to_acknowledge, _warnings = roster.standing(
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
    """A coordinator writes the swap into the schedule; one approval covers
    both directions of an exchange.

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
    roster as it is now, the version step of every schedule involved, the
    hand-over of every slot in both directions and the approved transition,
    all in the caller's one unit of work. Shared by the coordinator's approval
    and by an acceptance the policy lets stand on its own; `acknowledged` is
    that person's word that they have seen the hard rules the swap breaks.

    Returns `SwapAutoCancelled` when a slot changed owner since the request:
    the request is then cancelled, and that cancellation is meant to be kept.
    """
    # Schedule by schedule, in one order for every hand-over: two exchanges
    # that cross the same pair of publications then take them one after the
    # other instead of each waiting for the one the other holds.
    transfers = sorted(
        request.transfers(requester, replacement), key=lambda transfer: transfer.schedule_id
    )
    for transfer in transfers:
        duty = await ports.roster.duty_for_handover(transfer.schedule_id, transfer.slot)
        if duty is None:
            raise SwapPartiesGone()
        # Only the concrete slot matters. Unrelated swaps and overrides may
        # advance the schedule version without invalidating this request.
        if not duty.held_by(transfer.giver.id, transfer.giver.display_name):
            await ports.requests.record_decision(
                replace(request, status=SwapStatus.cancelled, decision_note=SLOT_CHANGED_OWNER_NOTE)
            )
            return SwapAutoCancelled(request.id)
    for move in request.moves:
        if await _takes_opposite_oncall(ports.roster, request.schedule_id, move, replacement):
            raise ReplacementOnCallSinceRequest()

    # Deciding validation (decision D3): the roster may have moved between the
    # request and the hand-over, so the hard rules are checked again here and
    # acknowledged by whoever decides now.
    roster = await _roster_around([day for day, _role in request.all_moves], ports)
    blocking, to_acknowledge, _warnings = roster.standing(
        request, requester.display_name, replacement.display_name
    )
    if blocking:
        raise SwapBreaksHardRules(blocking)
    if to_acknowledge and not acknowledged:
        raise SwapRuleViolationsNotAcknowledged(to_acknowledge)
    for schedule_id in dict.fromkeys(transfer.schedule_id for transfer in transfers):
        if not await ports.roster.advance_version(
            schedule_id, expected_version=None, only_if_published=True
        ):
            raise ScheduleChangedSinceRequest()
    for transfer in transfers:
        await ports.roster.hand_over(transfer.schedule_id, [transfer.slot], transfer.taker)
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
