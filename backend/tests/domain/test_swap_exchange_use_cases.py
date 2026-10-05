"""An exchange - a duty given and one taken in return - against in-memory
ports: what the two directions mean for each other, without a database."""

import uuid
from dataclasses import replace
from datetime import date, timedelta

import pytest

from oncall.domain.roster import Duty
from oncall.domain.swaps import errors
from oncall.domain.swaps.models import (
    SwapDecisionInput,
    SwapImpactQuery,
    SwapRequestInput,
    SwapRequestView,
)
from oncall.domain.swaps.use_cases import (
    accept_swap,
    approve_swap,
    preview_swap_impact,
    request_swap,
)
from oncall.domain.team import Actor, RolePeriod
from oncall.domain.vocabulary import AssignmentRole, ScheduleStatus, SwapStatus, UserRole
from tests.domain.fakes import FakeSchedule, World, actor, member

#: A Wednesday with no Polish holiday near it; `TODAY` is a week earlier.
DAY = date(2030, 3, 13)
TODAY = DAY - timedelta(days=7)
#: The Monday of that week: the duty Dawid gives back.
MONDAY = DAY - timedelta(days=2)
FRIDAY = DAY + timedelta(days=2)
REASON = "Urlop, nikt inny nie może"


def account(person) -> Actor:
    return Actor(user_id=person.user_id, display_name=person.display_name, role=UserRole.member)


@pytest.fixture
def world() -> World:
    """Anna is PRIMARY on Wednesday. Dawid served the three days before it,
    so taking her Wednesday as well would be his fourth day in a row."""
    world = World()
    world.anna = world.team.add(member("Anna"))
    world.bartek = world.team.add(member("Bartek"))
    world.dawid = world.team.add(member("Dawid"))
    world.roster.assign(DAY, AssignmentRole.primary, world.anna)
    world.roster.assign(DAY, AssignmentRole.secondary, world.bartek)
    world.roster.assign(DAY, AssignmentRole.late_shift, world.bartek)
    for offset in (1, 2, 3):
        world.roster.assign(DAY - timedelta(days=offset), AssignmentRole.primary, world.dawid)
    return world


def ask(world: World, *, in_return=(MONDAY, AssignmentRole.primary), **changes):
    values = {
        "actor": account(world.anna),
        "service_date": DAY,
        "role": AssignmentRole.primary,
        "replacement_member_id": world.dawid.id,
        "in_return": in_return,
    } | changes
    return request_swap(SwapRequestInput(**values), world.swaps, today=TODAY)


def second_publication(world: World, day: date, role: AssignmentRole) -> FakeSchedule:
    """Move a slot of the roster into a publication of its own."""
    other = FakeSchedule(id=uuid.uuid4())
    world.roster.schedules[other.id] = other
    duty = world.roster.schedule_ref.slots.pop((day, role))
    other.slots[(day, role)] = replace(duty, schedule_id=other.id)
    return other


async def test_both_directions_are_checked_as_one_move(world) -> None:
    """Alone, the Wednesday is a fourth day in a row for Dawid. With his
    Monday taken in return it only moves, and nothing is left to acknowledge."""
    with pytest.raises(errors.SwapRuleViolationsNotAcknowledged):
        await ask(world, in_return=None)

    view = await ask(world)

    assert view.request.slots == ((DAY, AssignmentRole.primary),)
    assert view.request.in_return is not None
    assert view.request.in_return.slots == ((MONDAY, AssignmentRole.primary),)
    assert view.request.in_return.schedule_id == world.roster.schedule_ref.id
    assert (view.rule_violations, view.warnings) == ((), ())
    assert view.return_slots == [(MONDAY, AssignmentRole.primary)]


async def test_an_exchange_that_still_breaks_a_rule_is_acknowledged_like_a_hand_over(
    world,
) -> None:
    """Dawid's Tuesday in return leaves him Sunday, Monday and then Wednesday:
    one rest day after a run of two."""
    tuesday = (DAY - timedelta(days=1), AssignmentRole.primary)

    with pytest.raises(errors.SwapRuleViolationsNotAcknowledged) as refused:
        await ask(world, in_return=tuesday)
    assert [(item.rule, item.member_name) for item in refused.value.violations] == [
        ("rest_after_run", "Dawid")
    ]
    with pytest.raises(errors.RuleBreakingSwapNeedsReason):
        await ask(world, in_return=tuesday, acknowledge_rule_violations=True)

    view = await ask(world, in_return=tuesday, acknowledge_rule_violations=True, note=REASON)

    assert [(item.rule, item.party) for item in view.request.rule_violations] == [
        ("rest_after_run", "replacement")
    ]


async def test_the_days_are_reserved_in_date_order_whichever_way_the_exchange_names_them(
    world,
) -> None:
    """Two requests that cross each other's days then wait for one another
    instead of each holding the day the other needs."""
    reserved = []
    has_active_request_for = world.requests.has_active_request_for

    async def recording(slot):
        reserved.append(slot)
        return await has_active_request_for(slot)

    world.requests.has_active_request_for = recording

    await ask(world)

    assert reserved == [(MONDAY, AssignmentRole.primary), (DAY, AssignmentRole.primary)]


async def test_one_approval_hands_over_both_directions_across_two_schedules(world) -> None:
    other = second_publication(world, MONDAY, AssignmentRole.primary)
    first = world.roster.schedule_ref
    view = await ask(world)
    assert view.request.in_return.schedule_id == other.id
    await accept_swap(
        SwapDecisionInput(account(world.dawid), view.request.id), world.swaps, today=TODAY
    )

    approved = await approve_swap(
        SwapDecisionInput(actor(UserRole.coordinator), view.request.id), world.swaps, today=TODAY
    )

    assert isinstance(approved, SwapRequestView)
    assert approved.request.status == SwapStatus.approved
    assert set(world.roster.handed_over) == {
        ((DAY, AssignmentRole.primary), world.dawid.id),
        ((MONDAY, AssignmentRole.primary), world.anna.id),
    }
    assert (first.version, other.version) == (2, 2)
    # The schedules are read, and so locked, in one order for every hand-over.
    in_order = sorted([(first.id, DAY), (other.id, MONDAY)])
    assert [day for day, _role in world.roster.handover_reads] == [day for _id, day in in_order]


async def test_a_schedule_retired_before_the_approval_stops_both_directions(world) -> None:
    other = second_publication(world, MONDAY, AssignmentRole.primary)
    view = await ask(world)
    await accept_swap(
        SwapDecisionInput(account(world.dawid), view.request.id), world.swaps, today=TODAY
    )
    other.status = ScheduleStatus.superseded
    world.roster.schedule_ref.slots[(MONDAY, AssignmentRole.primary)] = Duty(
        MONDAY, AssignmentRole.primary, world.dawid.id, "Dawid", False, world.roster.schedule_ref.id
    )

    with pytest.raises(errors.ScheduleChangedSinceRequest):
        await approve_swap(
            SwapDecisionInput(actor(UserRole.coordinator), view.request.id),
            world.swaps,
            today=TODAY,
        )

    assert world.roster.handed_over == []
    assert world.requests.by_id[view.request.id].status == SwapStatus.pending_coordinator


async def test_an_anchor_split_tolerated_on_one_day_does_not_excuse_the_other(world) -> None:
    """Each direction stands on its own day. Xena's SECONDARY goes to Yan, who
    cannot hold 11-19 that Wednesday: the shift stays, a tolerated split. In
    return she takes his Friday 11-19 without the SECONDARY she may no longer
    hold: a split the exchange makes itself, and has to acknowledge."""
    since = DAY - timedelta(days=400)
    xena = world.team.add(
        replace(
            member("Xena"),
            eligibility=(
                RolePeriod(AssignmentRole.secondary, since, DAY),
                RolePeriod(AssignmentRole.late_shift, since, None),
            ),
        )
    )
    yan = world.team.add(
        replace(
            member("Yan"),
            eligibility=(
                RolePeriod(AssignmentRole.secondary, since, None),
                RolePeriod(AssignmentRole.late_shift, FRIDAY, None),
            ),
        )
    )
    for day, holder in ((DAY, xena), (FRIDAY, yan)):
        world.roster.assign(day, AssignmentRole.secondary, holder)
        world.roster.assign(day, AssignmentRole.late_shift, holder)
    exchange = {
        "actor": account(xena),
        "role": AssignmentRole.secondary,
        "replacement_member_id": yan.id,
        "in_return": (FRIDAY, AssignmentRole.late_shift),
    }

    with pytest.raises(errors.SwapRuleViolationsNotAcknowledged) as refused:
        await ask(world, **exchange)
    assert {(item.rule, item.member_name, item.days) for item in refused.value.violations} == {
        ("late_shift_anchor", "Xena", (FRIDAY,)),
        ("late_shift_anchor", "Yan", (FRIDAY,)),
    }

    view = await ask(world, **exchange, acknowledge_rule_violations=True, note=REASON)

    assert view.request.slots == ((DAY, AssignmentRole.secondary),)
    assert view.request.in_return.slots == ((FRIDAY, AssignmentRole.late_shift),)
    assert {(item.rule, item.days) for item in view.warnings} == {("late_shift_anchor", (DAY,))}
    # The same split, read again from the stored request when it is accepted.
    with pytest.raises(errors.SwapRuleViolationsNotAcknowledged) as unaccepted:
        await accept_swap(
            SwapDecisionInput(account(yan), view.request.id), world.swaps, today=TODAY
        )
    assert {item.days for item in unaccepted.value.violations} == {(FRIDAY,)}


async def test_impact_of_an_exchange_projects_both_directions(world) -> None:
    impact = await preview_swap_impact(
        SwapImpactQuery(
            account(world.anna),
            DAY,
            AssignmentRole.primary,
            world.dawid.id,
            in_return=(MONDAY, AssignmentRole.primary),
        ),
        world.swaps,
    )

    assert (impact.points, impact.return_date, impact.return_points) == (1, MONDAY, 1)
    # A working day for a working day: nobody's total moves.
    assert impact.requester.after.total_points == impact.requester.before.total_points
    assert impact.replacement.after.total_points == impact.replacement.before.total_points
    assert impact.window_end == DAY


async def test_impact_reaches_to_the_last_day_an_exchange_moves(world) -> None:
    """The duty that comes back lies after the one given: the window ends on
    it, or the balance would not see it move."""
    world.roster.assign(FRIDAY, AssignmentRole.primary, world.dawid)

    impact = await preview_swap_impact(
        SwapImpactQuery(
            account(world.anna),
            DAY,
            AssignmentRole.primary,
            world.dawid.id,
            in_return=(FRIDAY, AssignmentRole.primary),
        ),
        world.swaps,
    )

    assert impact.window_end == FRIDAY
    assert impact.requester.after.total_points == impact.requester.before.total_points


async def test_impact_moves_the_late_shift_that_travels_with_its_role(world) -> None:
    """Bartek's SECONDARY carries 11-19 to Dawid; the preview used to move
    only the slot it was asked about."""
    impact = await preview_swap_impact(
        SwapImpactQuery(account(world.bartek), DAY, AssignmentRole.secondary, world.dawid.id),
        world.swaps,
    )

    assert impact.return_date is None and impact.return_points is None
    for lens in ("secondary", "late_shift"):
        before = getattr(impact.requester.before, lens).actual
        assert getattr(impact.requester.after, lens).actual == before - 1, lens


@pytest.mark.parametrize(("correction", "secondary_moves"), [(False, True), (True, False)])
async def test_a_correction_of_11_19_moves_it_alone_where_a_swap_takes_the_pair(
    world, correction, secondary_moves
) -> None:
    impact = await preview_swap_impact(
        SwapImpactQuery(
            actor(UserRole.coordinator),
            DAY,
            AssignmentRole.late_shift,
            world.dawid.id,
            correction=correction,
        ),
        world.swaps,
    )

    requester = impact.requester
    assert requester.after.late_shift.actual == requester.before.late_shift.actual - 1
    assert (requester.after.secondary.actual != requester.before.secondary.actual) is (
        secondary_moves
    )
