"""Swap use cases against in-memory ports: no database, no HTTP."""

from datetime import date, timedelta

import pytest

from oncall.domain.errors import NotATeamMember
from oncall.domain.swaps import errors
from oncall.domain.swaps.models import (
    ReplacementOptionsQuery,
    SwapAutoCancelled,
    SwapDecisionInput,
    SwapImpactQuery,
    SwapListQuery,
    SwapRequestInput,
    SwapRequestView,
)
from oncall.domain.swaps.use_cases import (
    accept_swap,
    approve_swap,
    cancel_swap,
    list_replacement_options,
    list_swap_requests,
    preview_swap_impact,
    reject_swap,
    request_swap,
)
from oncall.domain.team import Actor
from oncall.domain.vocabulary import (
    AssignmentRole,
    RotationMode,
    ScheduleStatus,
    SwapStatus,
    UserRole,
)
from tests.domain.fakes import World, member, pending_swap

#: A Wednesday with no Polish holiday near it; `TODAY` is a week earlier.
DAY = date(2030, 3, 13)
TODAY = DAY - timedelta(days=7)


def account(person, role: UserRole = UserRole.member) -> Actor:
    return Actor(user_id=person.user_id, display_name=person.display_name, role=role)


@pytest.fixture
def world() -> World:
    world = World()
    world.anna = world.team.add(member("Anna"))
    world.bartek = world.team.add(member("Bartek"))
    world.dawid = world.team.add(member("Dawid"))
    world.roster.assign(DAY, AssignmentRole.primary, world.anna)
    world.roster.assign(DAY, AssignmentRole.secondary, world.bartek)
    world.roster.assign(DAY, AssignmentRole.late_shift, world.bartek)
    return world


def ask(world: World, replacement, *, role=AssignmentRole.primary, day=DAY, requester=None):
    return request_swap(
        SwapRequestInput(
            actor=account(requester or world.anna),
            service_date=day,
            role=role,
            replacement_member_id=replacement.id,
        ),
        world.swaps,
        today=TODAY,
    )


async def test_request_is_stored_waiting_for_the_replacement(world) -> None:
    view = await ask(world, world.dawid)

    assert view.request.status == SwapStatus.pending_replacement
    assert view.request.slots == ((DAY, AssignmentRole.primary),)
    assert (view.requester_name, view.replacement_name) == ("Anna", "Dawid")
    assert world.journal.names == ["requested"]
    assert list(world.requests.by_id.values()) == [view.request]


async def test_a_past_duty_cannot_be_swapped(world) -> None:
    with pytest.raises(errors.SwapInThePast):
        await request_swap(
            SwapRequestInput(account(world.anna), DAY, AssignmentRole.primary, world.dawid.id),
            world.swaps,
            today=DAY + timedelta(days=1),
        )


async def test_an_account_without_a_member_cannot_ask(world) -> None:
    stranger = Actor(user_id=member("Nobody").user_id, display_name="x", role=UserRole.member)
    with pytest.raises(NotATeamMember):
        await request_swap(
            SwapRequestInput(stranger, DAY, AssignmentRole.primary, world.dawid.id),
            world.swaps,
            today=TODAY,
        )


async def test_only_the_holder_may_ask_for_a_slot(world) -> None:
    with pytest.raises(errors.SlotNotYours):
        await ask(world, world.dawid, requester=world.bartek)


async def test_an_unpublished_slot_cannot_be_swapped(world) -> None:
    with pytest.raises(errors.SlotNotPublished):
        await ask(world, world.dawid, day=DAY + timedelta(days=1))


@pytest.mark.parametrize(
    ("replacement_kwargs", "error"),
    [
        ({"roles": (AssignmentRole.secondary,)}, errors.ReplacementNotEligible),
        ({"has_account": False}, errors.ReplacementHasNoAccount),
        ({"unavailable": (DAY,)}, errors.ReplacementUnavailable),
    ],
)
async def test_the_replacement_must_be_able_to_take_the_duty(
    world, replacement_kwargs, error
) -> None:
    replacement = world.team.add(member("Ewa", **replacement_kwargs))
    with pytest.raises(error):
        await ask(world, replacement)
    assert world.requests.by_id == {}


async def test_nobody_swaps_with_themselves(world) -> None:
    with pytest.raises(errors.CannotSwapWithYourself):
        await ask(world, world.anna)


async def test_the_replacement_cannot_end_up_with_both_oncall_roles(world) -> None:
    with pytest.raises(errors.ReplacementAlreadyOnCall):
        await ask(world, world.bartek)


async def test_a_slot_carries_one_active_request_at_a_time(world) -> None:
    await ask(world, world.dawid)
    other = world.team.add(member("Ewa"))
    with pytest.raises(errors.SlotHasActiveSwap):
        await ask(world, other)


async def test_a_request_breaking_hard_rules_is_refused_with_the_violations(world) -> None:
    for offset in (1, 2, 3):
        world.roster.assign(DAY - timedelta(days=offset), AssignmentRole.primary, world.dawid)

    with pytest.raises(errors.SwapBreaksHardRules) as refused:
        await ask(world, world.dawid)

    assert {item.rule for item in refused.value.violations} >= {"max_consecutive"}
    assert all(item.member_name == "Dawid" for item in refused.value.violations)
    assert refused.value.next_step == errors.BLOCKED_NEXT_STEP
    assert world.journal.events == []


async def test_weekly_rotation_does_not_block_the_runs_it_is_built_from(world) -> None:
    """The same request, under a rotation that has no rest rules.

    Weekly rotation puts one person on for a whole week, so the solver compiles
    none of the rolling rest constraints. A swap path that still enforced them
    would refuse edits to rosters this very system generated - the mode would
    produce schedules its own swap screen cannot touch.
    """
    for offset in (1, 2, 3):
        world.roster.assign(DAY - timedelta(days=offset), AssignmentRole.primary, world.dawid)
    world.policy.mode = RotationMode.weekly

    view = await ask(world, world.dawid)

    assert view.request.status == SwapStatus.pending_replacement
    # Not merely unblocked: nothing is reported as bent either, because under
    # this rotation there is no rest rule to bend.
    assert view.warnings == ()
    assert world.journal.events


async def test_the_anchor_role_carries_the_late_shift_with_it(world) -> None:
    view = await ask(world, world.dawid, role=AssignmentRole.secondary, requester=world.bartek)
    assert set(view.request.slots) == {
        (DAY, AssignmentRole.secondary),
        (DAY, AssignmentRole.late_shift),
    }


async def test_accepting_hands_the_request_to_a_coordinator(world) -> None:
    request = pending_swap(
        world, world.anna, world.dawid, DAY, status=SwapStatus.pending_replacement
    )
    view = await accept_swap(
        SwapDecisionInput(account(world.dawid), request.id), world.swaps, today=TODAY
    )
    assert view.request.status == SwapStatus.pending_coordinator
    assert world.journal.names == ["accepted"]


async def test_without_coordinator_approval_the_acceptance_is_the_hand_over(world) -> None:
    """Policy off: the replacement's acceptance writes the swap into the
    schedule the way an approval would, and nothing ever waits for a
    coordinator."""
    world.policy.coordinator_approval = False
    request = pending_swap(
        world, world.anna, world.dawid, DAY, status=SwapStatus.pending_replacement
    )

    view = await accept_swap(
        SwapDecisionInput(account(world.dawid), request.id), world.swaps, today=TODAY
    )

    assert isinstance(view, SwapRequestView)
    assert view.request.status == SwapStatus.approved
    assert world.requests.by_id[request.id].status == SwapStatus.approved
    assert world.roster.handed_over == [((DAY, AssignmentRole.primary), world.dawid.id)]
    assert world.roster.schedule_ref.version == 2
    assert world.journal.names == ["approved"]
    assert world.journal.events[0][1]["by_coordinator"] is False
    assert world.journal.events[0][1]["self_approved"] is False


async def test_without_coordinator_approval_the_acceptance_rechecks_the_roster(world) -> None:
    """The deciding checks of an approval apply to the acceptance too: a
    slot that changed owner cancels the request, and a replacement who took
    the opposite on-call role meanwhile is refused."""
    world.policy.coordinator_approval = False
    changed = pending_swap(
        world, world.anna, world.dawid, DAY, status=SwapStatus.pending_replacement
    )
    world.roster.assign(DAY, AssignmentRole.primary, world.team.add(member("Ewa")))

    outcome = await accept_swap(
        SwapDecisionInput(account(world.dawid), changed.id), world.swaps, today=TODAY
    )

    assert outcome == SwapAutoCancelled(changed.id)
    assert world.roster.handed_over == []
    assert world.journal.events == []

    world.roster.assign(DAY, AssignmentRole.primary, world.anna)
    on_call = pending_swap(
        world, world.anna, world.dawid, DAY, status=SwapStatus.pending_replacement
    )
    world.roster.assign(DAY, AssignmentRole.secondary, world.dawid)
    with pytest.raises(errors.ReplacementOnCallSinceRequest):
        await accept_swap(
            SwapDecisionInput(account(world.dawid), on_call.id), world.swaps, today=TODAY
        )


async def test_without_coordinator_approval_a_coordinator_accepts_their_own_swap(world) -> None:
    """The self-approval guard belongs to a coordinator deciding as one; a
    replacement who happens to coordinate accepts like anybody else."""
    world.policy.coordinator_approval = False
    request = pending_swap(
        world, world.anna, world.dawid, DAY, status=SwapStatus.pending_replacement
    )
    dawid_as_coordinator = account(world.dawid, UserRole.coordinator)
    world.team.approvers = {dawid_as_coordinator.user_id, member("Other").user_id}

    view = await accept_swap(
        SwapDecisionInput(dawid_as_coordinator, request.id), world.swaps, today=TODAY
    )

    assert isinstance(view, SwapRequestView)
    assert view.request.status == SwapStatus.approved


async def test_a_request_a_coordinator_already_holds_is_still_theirs_to_decide(world) -> None:
    """Switching the approval off does not orphan what already waits for a
    coordinator: the approval and the rejection paths stay open for it."""
    request = pending_swap(world, world.anna, world.dawid, DAY)
    world.policy.coordinator_approval = False

    view = await approve_swap(
        SwapDecisionInput(coordinator(), request.id), world.swaps, today=TODAY
    )

    assert isinstance(view, SwapRequestView)
    assert view.request.status == SwapStatus.approved
    assert world.journal.events[-1][1]["by_coordinator"] is True


async def test_only_the_named_replacement_accepts(world) -> None:
    request = pending_swap(
        world, world.anna, world.dawid, DAY, status=SwapStatus.pending_replacement
    )
    with pytest.raises(errors.OnlyNamedReplacementMayAccept):
        await accept_swap(
            SwapDecisionInput(account(world.bartek), request.id), world.swaps, today=TODAY
        )


async def test_accepting_twice_is_refused(world) -> None:
    request = pending_swap(world, world.anna, world.dawid, DAY)
    with pytest.raises(errors.SwapNotAwaitingReplacement):
        await accept_swap(
            SwapDecisionInput(account(world.dawid), request.id), world.swaps, today=TODAY
        )


async def test_a_member_cannot_reject_what_the_replacement_already_accepted(world) -> None:
    request = pending_swap(world, world.anna, world.dawid, DAY)
    with pytest.raises(errors.OnlyCoordinatorMayRejectAccepted):
        await reject_swap(
            SwapDecisionInput(account(world.dawid), request.id, "Nie pasuje"), world.swaps
        )


async def test_a_coordinator_rejects_an_accepted_request_with_a_reason(world) -> None:
    request = pending_swap(world, world.anna, world.dawid, DAY)
    coordinator = Actor(user_id=member("K").user_id, display_name="K", role=UserRole.coordinator)
    view = await reject_swap(
        SwapDecisionInput(coordinator, request.id, "Za dużo dyżurów"), world.swaps
    )

    assert view.request.status == SwapStatus.rejected
    assert view.request.decision_note == "Za dużo dyżurów"
    assert world.journal.events[0][1]["by_coordinator"] is True


async def test_a_decision_reason_cannot_be_blank(world) -> None:
    request = pending_swap(world, world.anna, world.dawid, DAY)
    with pytest.raises(errors.DecisionReasonRequired):
        await cancel_swap(SwapDecisionInput(account(world.anna), request.id, "   "), world.swaps)


async def test_only_the_requester_withdraws_and_only_while_pending(world) -> None:
    request = pending_swap(world, world.anna, world.dawid, DAY, status=SwapStatus.rejected)
    with pytest.raises(errors.OnlyRequesterMayCancel):
        await cancel_swap(SwapDecisionInput(account(world.dawid), request.id, "powód"), world.swaps)
    with pytest.raises(errors.SwapNoLongerCancellable):
        await cancel_swap(SwapDecisionInput(account(world.anna), request.id, "powód"), world.swaps)


def coordinator() -> Actor:
    return Actor(user_id=member("K").user_id, display_name="K", role=UserRole.coordinator)


async def test_approval_hands_the_slot_over_and_moves_the_version(world) -> None:
    request = pending_swap(world, world.anna, world.dawid, DAY)
    view = await approve_swap(
        SwapDecisionInput(coordinator(), request.id), world.swaps, today=TODAY
    )

    assert view.request.status == SwapStatus.approved
    assert world.roster.handed_over == [((DAY, AssignmentRole.primary), world.dawid.id)]
    assert world.roster.schedule_ref.version == 2
    assert world.roster.handover_reads == [(DAY, AssignmentRole.primary)]
    assert world.journal.names == ["approved"]


async def test_approval_of_a_slot_that_changed_owner_cancels_the_request(world) -> None:
    request = pending_swap(world, world.anna, world.dawid, DAY)
    world.roster.assign(DAY, AssignmentRole.primary, world.team.add(member("Ewa")))

    outcome = await approve_swap(
        SwapDecisionInput(coordinator(), request.id), world.swaps, today=TODAY
    )

    assert outcome == SwapAutoCancelled(request.id)
    stored = world.requests.by_id[request.id]
    assert stored.status == SwapStatus.cancelled
    assert stored.decision_note == errors.SLOT_CHANGED_OWNER_NOTE
    assert world.roster.handed_over == []
    assert world.journal.events == []


async def test_approval_under_weekly_rotation_is_not_blocked_by_the_rest_rules(world) -> None:
    """The second gate takes the mode too.

    Approval re-checks the hard rules, because the roster can move between the
    request and the decision. A request accepted under weekly rotation that was
    then refused at approval would leave the coordinator with a swap nobody can
    finish.
    """
    request = pending_swap(world, world.anna, world.dawid, DAY)
    for offset in (1, 2, 3):
        world.roster.assign(DAY - timedelta(days=offset), AssignmentRole.primary, world.dawid)
    world.policy.mode = RotationMode.weekly

    view = await approve_swap(
        SwapDecisionInput(coordinator(), request.id), world.swaps, today=TODAY
    )

    assert view.request.status == SwapStatus.approved
    assert world.roster.handed_over == [((DAY, AssignmentRole.primary), world.dawid.id)]


async def test_approval_after_a_concurrent_roster_change_hands_nothing_over(world) -> None:
    request = pending_swap(world, world.anna, world.dawid, DAY)
    # Republished meanwhile: the schedule the request belongs to is retired.
    world.roster.schedule_ref.status = ScheduleStatus.superseded

    with pytest.raises(errors.ScheduleChangedSinceRequest):
        await approve_swap(SwapDecisionInput(coordinator(), request.id), world.swaps, today=TODAY)
    assert world.roster.handed_over == []
    assert world.requests.by_id[request.id].status == SwapStatus.pending_coordinator


async def test_own_swap_is_approved_by_another_coordinator_when_there_is_one(world) -> None:
    request = pending_swap(world, world.anna, world.dawid, DAY)
    anna_as_coordinator = account(world.anna, UserRole.coordinator)
    world.team.approvers = {anna_as_coordinator.user_id, member("Other").user_id}

    with pytest.raises(errors.SelfApprovalNotAllowed):
        await approve_swap(
            SwapDecisionInput(anna_as_coordinator, request.id), world.swaps, today=TODAY
        )

    world.team.approvers = {anna_as_coordinator.user_id}
    view = await approve_swap(
        SwapDecisionInput(anna_as_coordinator, request.id), world.swaps, today=TODAY
    )
    assert world.journal.events[-1][1]["self_approved"] is True
    assert view.request.status == SwapStatus.approved


async def test_approval_rechecks_that_the_replacement_is_not_on_call_meanwhile(world) -> None:
    request = pending_swap(world, world.anna, world.dawid, DAY)
    world.roster.assign(DAY, AssignmentRole.secondary, world.dawid)
    with pytest.raises(errors.ReplacementOnCallSinceRequest):
        await approve_swap(SwapDecisionInput(coordinator(), request.id), world.swaps, today=TODAY)


async def test_the_candidate_list_takes_the_rotation_into_account(world) -> None:
    """The list says why a candidate cannot be picked, so it must ask the same
    question the request will: under weekly rotation, a long run is no reason
    to grey somebody out."""
    for offset in (1, 2, 3):
        world.roster.assign(DAY - timedelta(days=offset), AssignmentRole.primary, world.dawid)

    blocked = await list_replacement_options(
        ReplacementOptionsQuery(account(world.anna), DAY, AssignmentRole.primary),
        world.swaps,
        today=TODAY,
    )
    world.policy.mode = RotationMode.weekly
    offered = await list_replacement_options(
        ReplacementOptionsQuery(account(world.anna), DAY, AssignmentRole.primary),
        world.swaps,
        today=TODAY,
    )

    assert {item.rule for item in blocked[0].blocking_violations} == {
        "max_consecutive",
        "three_in_seven",
    }
    assert offered[0].blocking_violations == ()


async def test_options_leave_out_whoever_cannot_take_the_slot(world) -> None:
    world.team.add(member("Ewa", unavailable=(DAY,)))
    world.team.add(member("Filip", has_account=False))
    world.team.add(member("Gosia", roles=(AssignmentRole.secondary,)))

    options = await list_replacement_options(
        ReplacementOptionsQuery(account(world.anna), DAY, AssignmentRole.primary),
        world.swaps,
        today=TODAY,
    )

    # Bartek holds the opposite on-call role that day, the rest cannot serve.
    assert [option.member.display_name for option in options] == ["Dawid"]
    assert options[0].blocking_violations == ()
    assert options[0].next_step is None


async def test_options_for_a_past_day_are_empty_before_anything_is_read() -> None:
    world = World()
    stranger = Actor(user_id=member("x").user_id, display_name="x", role=UserRole.member)
    options = await list_replacement_options(
        ReplacementOptionsQuery(stranger, DAY, AssignmentRole.primary),
        world.swaps,
        today=DAY + timedelta(days=1),
    )
    assert options == []


async def test_options_block_a_candidate_a_coupled_swap_would_double_book(world) -> None:
    world.roster.assign(DAY, AssignmentRole.primary, world.dawid)
    options = await list_replacement_options(
        ReplacementOptionsQuery(account(world.bartek), DAY, AssignmentRole.late_shift),
        world.swaps,
        today=TODAY,
    )
    dawid = next(option for option in options if option.member.id == world.dawid.id)
    assert "double_oncall" in {item.rule for item in dawid.blocking_violations}
    assert dawid.next_step == errors.BLOCKED_NEXT_STEP


async def test_impact_is_hidden_from_viewers(world) -> None:
    viewer = Actor(user_id=member("v").user_id, display_name="v", role=UserRole.viewer)
    with pytest.raises(errors.PointsHiddenFromViewers):
        await preview_swap_impact(
            SwapImpactQuery(viewer, DAY, AssignmentRole.primary, world.dawid.id), world.swaps
        )


async def test_a_member_previews_only_swaps_they_take_part_in(world) -> None:
    with pytest.raises(errors.OnlyOwnSwapsPreview):
        await preview_swap_impact(
            SwapImpactQuery(account(world.bartek), DAY, AssignmentRole.primary, world.dawid.id),
            world.swaps,
        )


async def test_impact_moves_the_points_of_the_duty_between_both_people(world) -> None:
    impact = await preview_swap_impact(
        SwapImpactQuery(account(world.anna), DAY, AssignmentRole.primary, world.dawid.id),
        world.swaps,
    )
    assert impact.points == 1
    assert impact.requester.after.total_points == impact.requester.before.total_points - 1
    assert impact.replacement.after.total_points == impact.replacement.before.total_points + 1


async def test_impact_of_a_slot_nobody_on_the_team_holds_is_a_conflict(world) -> None:
    world.roster.assign(DAY, AssignmentRole.primary, "Imported Person")
    with pytest.raises(errors.SlotHolderNotATeamMember):
        await preview_swap_impact(
            SwapImpactQuery(coordinator(), DAY, AssignmentRole.primary, world.dawid.id),
            world.swaps,
        )


async def test_members_list_only_the_requests_they_take_part_in(world) -> None:
    mine = pending_swap(world, world.anna, world.dawid, DAY)
    pending_swap(world, world.bartek, world.team.add(member("Ewa")), DAY + timedelta(days=1))

    views = await list_swap_requests(SwapListQuery(account(world.anna)), world.swaps)
    assert [view.request.id for view in views] == [mine.id]

    everything = await list_swap_requests(SwapListQuery(coordinator()), world.swaps)
    assert len(everything) == 2
