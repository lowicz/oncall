"""What a request gives of a day - the whole duty or one of its two slots -
against in-memory ports, under each on-call role 11-19 may be anchored to.

Every scenario runs twice: with 11-19 following SECONDARY and following
PRIMARY. Anna holds the anchor role and 11-19 on Wednesday, Ewa holds the
other on-call role that day, Dawid is free and Celina may not hold 11-19.
"""

from datetime import date, timedelta

import pytest

from oncall.domain.roster import OPPOSITE_ONCALL
from oncall.domain.swaps import errors
from oncall.domain.swaps.models import (
    ReplacementOptionsQuery,
    ReturnOptionsQuery,
    SwapDecisionInput,
    SwapImpactQuery,
    SwapListQuery,
    SwapRequestInput,
)
from oncall.domain.swaps.use_cases import (
    accept_swap,
    approve_swap,
    list_replacement_options,
    list_return_options,
    list_swap_requests,
    preview_swap_impact,
    request_swap,
    swap_policy,
)
from oncall.domain.team import Actor
from oncall.domain.vocabulary import AssignmentRole, LateShiftAnchor, SwapStatus, UserRole
from tests.domain.fakes import World, member

#: A Wednesday with no Polish holiday near it; `TODAY` is a week earlier.
DAY = date(2030, 3, 13)
TODAY = DAY - timedelta(days=7)
THURSDAY = DAY + timedelta(days=1)
FRIDAY = DAY + timedelta(days=2)
LATE = AssignmentRole.late_shift


def account(person, role: UserRole = UserRole.member) -> Actor:
    return Actor(user_id=person.user_id, display_name=person.display_name, role=role)


def coordinator() -> Actor:
    return Actor(user_id=member("K").user_id, display_name="K", role=UserRole.coordinator)


@pytest.fixture(params=[AssignmentRole.secondary, AssignmentRole.primary], ids=lambda role: role)
def anchor(request) -> AssignmentRole:
    return request.param


@pytest.fixture
def other(anchor) -> AssignmentRole:
    """The on-call role 11-19 does not travel with."""
    return OPPOSITE_ONCALL[anchor]


@pytest.fixture
def world(anchor, other) -> World:
    world = World()
    world.policy.anchor = LateShiftAnchor(anchor.value)
    world.anna = world.team.add(member("Anna"))
    world.bartek = world.team.add(member("Bartek"))
    world.dawid = world.team.add(member("Dawid"))
    world.ewa = world.team.add(member("Ewa"))
    world.celina = world.team.add(
        member("Celina", roles=(AssignmentRole.primary, AssignmentRole.secondary))
    )
    world.roster.assign(DAY, anchor, world.anna)
    world.roster.assign(DAY, LATE, world.anna)
    world.roster.assign(DAY, other, world.ewa)
    return world


def ask(world, replacement, role, scope=None, *, day=DAY, requester=None, acknowledge=False):
    return request_swap(
        SwapRequestInput(
            actor=account(requester or world.anna),
            service_date=day,
            role=role,
            replacement_member_id=replacement.id,
            acknowledge_rule_violations=acknowledge,
            scope=scope,
        ),
        world.swaps,
        today=TODAY,
    )


def accept(world, replacement, request_id, *, acknowledge=False):
    return accept_swap(
        SwapDecisionInput(
            account(replacement), request_id, acknowledge_rule_violations=acknowledge
        ),
        world.swaps,
        today=TODAY,
    )


def approve(world, request_id, *, acknowledge=False):
    return approve_swap(
        SwapDecisionInput(coordinator(), request_id, acknowledge_rule_violations=acknowledge),
        world.swaps,
        today=TODAY,
    )


def split(*names: str) -> set[tuple[str, str]]:
    return {("late_shift_anchor", name) for name in names}


def rules(violations) -> set[tuple[str, str]]:
    return {(item.rule, item.member_name) for item in violations}


async def test_without_a_scope_the_pair_moves_from_either_slot(world, anchor) -> None:
    """What a request moved before it could name a scope; the duty is now
    named by its on-call role whichever slot was asked for."""
    view = await ask(world, world.dawid, LATE)

    assert view.request.slots == ((DAY, anchor), (DAY, LATE))
    assert view.request.role == anchor
    assert view.rule_violations == ()


async def test_the_whole_duty_moves_both_slots_from_either_slot(world, anchor) -> None:
    view = await ask(world, world.dawid, LATE, "whole")

    assert view.request.slots == ((DAY, anchor), (DAY, LATE))
    assert view.request.role == anchor


@pytest.mark.parametrize("kept", ["anchor", "late"])
async def test_one_slot_of_the_pair_is_given_knowingly_at_every_step(world, anchor, kept) -> None:
    """A split the member chooses is a broken rule like a rest rule: the
    requester, the replacement and the coordinator each acknowledge it."""
    given = LATE if kept == "anchor" else anchor

    with pytest.raises(errors.SwapRuleViolationsNotAcknowledged) as refused:
        await ask(world, world.dawid, given, "single")
    assert rules(refused.value.violations) == split("Anna", "Dawid")

    view = await ask(world, world.dawid, given, "single", acknowledge=True)
    assert view.request.slots == ((DAY, given),)
    assert view.request.role == given
    assert {item.party for item in view.request.rule_violations} == {"requester", "replacement"}
    assert view.warnings == ()

    with pytest.raises(errors.SwapRuleViolationsNotAcknowledged):
        await accept(world, world.dawid, view.request.id)
    accepted = await accept(world, world.dawid, view.request.id, acknowledge=True)
    assert accepted.request.status == SwapStatus.pending_coordinator

    with pytest.raises(errors.SwapRuleViolationsNotAcknowledged):
        await approve(world, view.request.id)
    approved = await approve(world, view.request.id, acknowledge=True)
    assert approved.request.status == SwapStatus.approved
    assert world.roster.handed_over == [((DAY, given), world.dawid.id)]


async def test_an_open_split_is_listed_as_a_broken_rule(world) -> None:
    await ask(world, world.dawid, LATE, "single", acknowledge=True)

    (view,) = await list_swap_requests(SwapListQuery(coordinator()), world.swaps)

    assert rules(view.rule_violations) == split("Anna", "Dawid")
    assert view.warnings == ()


@pytest.mark.parametrize("scope", [None, "whole", "single"])
async def test_whoever_cannot_hold_the_late_shift_takes_the_anchor_role_as_an_exception(
    world, anchor, scope
) -> None:
    """The split is then the taker's, not the requester's choice: a warning
    from the request to the hand-over, whatever the scope asked for."""
    view = await ask(world, world.celina, anchor, scope)

    assert view.request.slots == ((DAY, anchor),)
    assert view.rule_violations == ()
    assert rules(view.warnings) == split("Anna", "Celina")

    await accept(world, world.celina, view.request.id)
    approved = await approve(world, view.request.id)
    assert approved.request.status == SwapStatus.approved


async def test_the_holder_of_the_other_oncall_role_may_take_the_late_shift_alone(
    world, anchor
) -> None:
    """Nobody holds both on-call roles on a day; 11-19 is not one of them."""
    for role, scope in [(anchor, None), (anchor, "whole"), (anchor, "single"), (LATE, None)]:
        with pytest.raises(errors.ReplacementAlreadyOnCall):
            await ask(world, world.ewa, role, scope, acknowledge=True)

    with pytest.raises(errors.SwapRuleViolationsNotAcknowledged) as refused:
        await ask(world, world.ewa, LATE, "single")
    assert rules(refused.value.violations) == split("Anna", "Ewa")

    view = await ask(world, world.ewa, LATE, "single", acknowledge=True)
    assert view.request.slots == ((DAY, LATE),)
    assert rules(view.warnings) == {("oncall_late_shift_overlap", "Ewa")}


async def test_the_candidates_are_judged_for_the_scope(world, anchor) -> None:
    async def options(role, scope=None):
        listed = await list_replacement_options(
            ReplacementOptionsQuery(account(world.anna), DAY, role, scope),
            world.swaps,
            today=TODAY,
        )
        return {option.member.display_name: option for option in listed}

    whole = await options(anchor, "whole")
    assert set(whole) == {"Bartek", "Celina", "Dawid"}
    assert whole["Dawid"].slots == ((DAY, anchor), (DAY, LATE))
    assert whole["Celina"].slots == ((DAY, anchor),)
    assert rules(whole["Celina"].warning_violations) == split("Anna", "Celina")

    late = await options(LATE, "single")
    assert set(late) == {"Bartek", "Dawid", "Ewa"}
    assert late["Dawid"].slots == ((DAY, LATE),)
    assert rules(late["Dawid"].rule_violations) == split("Anna", "Dawid")
    assert late["Ewa"].blocking_violations == ()
    assert rules(late["Ewa"].rule_violations) == split("Anna", "Ewa")
    assert rules(late["Ewa"].warning_violations) == {("oncall_late_shift_overlap", "Ewa")}

    # Without a scope the pair would give Ewa both on-call roles.
    coupled = await options(LATE)
    assert ("double_oncall", "Ewa") in rules(coupled["Ewa"].blocking_violations)


async def test_whole_takes_both_slots_of_a_pair_no_anchor_binds(world, anchor, other) -> None:
    """Anna holds the other on-call role and 11-19 on Thursday: without a
    scope each slot moves alone, as it did, and the whole duty is both."""
    world.roster.assign(THURSDAY, anchor, world.bartek)
    world.roster.assign(THURSDAY, other, world.anna)
    world.roster.assign(THURSDAY, LATE, world.anna)

    async def dawid_takes(role, scope=None):
        listed = await list_replacement_options(
            ReplacementOptionsQuery(account(world.anna), THURSDAY, role, scope),
            world.swaps,
            today=TODAY,
        )
        return next(option.slots for option in listed if option.member == world.dawid)

    assert await dawid_takes(LATE) == ((THURSDAY, LATE),)
    assert await dawid_takes(other) == ((THURSDAY, other),)
    assert await dawid_takes(LATE, "whole") == ((THURSDAY, other), (THURSDAY, LATE))

    view = await ask(world, world.dawid, LATE, "whole", day=THURSDAY, acknowledge=True)
    assert view.request.slots == ((THURSDAY, other), (THURSDAY, LATE))
    assert view.request.role == other


async def test_under_an_independent_late_shift_the_whole_duty_needs_both_roles(
    world, anchor
) -> None:
    world.policy.anchor = LateShiftAnchor.independent

    listed = await list_replacement_options(
        ReplacementOptionsQuery(account(world.anna), DAY, anchor, "whole"),
        world.swaps,
        today=TODAY,
    )
    assert {option.member.display_name: option.slots for option in listed} == {
        "Bartek": ((DAY, anchor), (DAY, LATE)),
        "Dawid": ((DAY, anchor), (DAY, LATE)),
    }
    with pytest.raises(errors.ReplacementNotEligible):
        await ask(world, world.celina, anchor, "whole")

    view = await ask(world, world.dawid, anchor, "whole")
    assert view.request.slots == ((DAY, anchor), (DAY, LATE))


async def test_the_impact_projects_only_the_slots_the_scope_gives(world, anchor) -> None:
    impact = await preview_swap_impact(
        SwapImpactQuery(account(world.anna), DAY, LATE, world.dawid.id, scope="single"),
        world.swaps,
    )

    for side, change in ((impact.requester, -1), (impact.replacement, 1)):
        assert side.after.late_shift.actual == side.before.late_shift.actual + change
        assert getattr(side.after, anchor).actual == getattr(side.before, anchor).actual


async def test_an_exchange_is_judged_for_the_slot_given(world, anchor) -> None:
    """Giving 11-19 alone for Dawid's whole Friday splits Wednesday's pair."""
    world.roster.assign(FRIDAY, anchor, world.dawid)
    world.roster.assign(FRIDAY, LATE, world.dawid)

    async def friday(scope):
        (option,) = await list_return_options(
            ReturnOptionsQuery(account(world.anna), DAY, LATE, world.dawid.id, scope),
            world.swaps,
            today=TODAY,
        )
        assert option.slots == ((FRIDAY, anchor), (FRIDAY, LATE))
        return option

    assert (await friday(None)).rule_violations == ()
    assert rules((await friday("single")).rule_violations) == split("Anna", "Dawid")


async def test_the_anchor_role_given_away_from_a_third_persons_late_shift_stays_acknowledged(
    world, anchor
) -> None:
    """Celina may not hold 11-19, so Bartek serves it beside her on Friday.
    Dawid could hold it: his taking the anchor role alone is a split to
    acknowledge on the request and on every decision after it."""
    world.roster.assign(FRIDAY, anchor, world.celina)
    world.roster.assign(FRIDAY, LATE, world.bartek)

    with pytest.raises(errors.SwapRuleViolationsNotAcknowledged):
        await ask(world, world.dawid, anchor, day=FRIDAY, requester=world.celina)
    view = await ask(
        world, world.dawid, anchor, day=FRIDAY, requester=world.celina, acknowledge=True
    )
    assert view.request.slots == ((FRIDAY, anchor),)

    with pytest.raises(errors.SwapRuleViolationsNotAcknowledged):
        await accept(world, world.dawid, view.request.id)


async def test_the_swap_policy_names_the_anchor(world, anchor) -> None:
    assert (await swap_policy(world.swaps)).late_shift_anchor == anchor.value
