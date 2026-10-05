"""What a request gives of a day - the whole duty or one of its two slots -
and what it takes of the day that comes back in an exchange, against
in-memory ports, under each on-call role 11-19 may be anchored to.

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
SATURDAY = DAY + timedelta(days=3)
MONDAY = DAY + timedelta(days=5)
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


def ask(
    world,
    replacement,
    role,
    scope=None,
    *,
    day=DAY,
    requester=None,
    acknowledge=False,
    in_return=None,
    return_scope=None,
):
    return request_swap(
        SwapRequestInput(
            actor=account(requester or world.anna),
            service_date=day,
            role=role,
            replacement_member_id=replacement.id,
            acknowledge_rule_violations=acknowledge,
            in_return=in_return,
            scope=scope,
            return_scope=return_scope,
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


def dawid_holds_the_pair_on_friday(world, anchor) -> None:
    world.roster.assign(FRIDAY, anchor, world.dawid)
    world.roster.assign(FRIDAY, LATE, world.dawid)


async def returns(world, role, scope=None, *, day=DAY, requester=None):
    """Dawid's days the requester could take back for `role` of `day`."""
    listed = await list_return_options(
        ReturnOptionsQuery(account(requester or world.anna), day, role, world.dawid.id, scope),
        world.swaps,
        today=TODAY,
    )
    return {option.service_date: option for option in listed}


def ways(option) -> list[tuple]:
    """How a day may be taken, the way it is offered first leading."""
    return [(way.role, way.scope, way.slots) for way in (option, *option.parts)]


async def test_a_day_is_offered_as_it_is_taken_by_default_with_its_other_ways(
    world, anchor, other
) -> None:
    """The pair the anchor binds comes back whole unless asked otherwise; a
    pair it does not bind one role at a time; a day with one role has no
    other way to be taken."""
    dawid_holds_the_pair_on_friday(world, anchor)
    world.roster.assign(SATURDAY, anchor, world.dawid)
    world.roster.assign(MONDAY, anchor, world.bartek)
    world.roster.assign(MONDAY, other, world.dawid)
    world.roster.assign(MONDAY, LATE, world.dawid)

    offered = await returns(world, anchor, "whole")

    assert ways(offered[FRIDAY]) == [
        (anchor, "whole", ((FRIDAY, anchor), (FRIDAY, LATE))),
        (anchor, "single", ((FRIDAY, anchor),)),
        (LATE, "single", ((FRIDAY, LATE),)),
    ]
    assert offered[FRIDAY].rule_violations == ()
    for part in offered[FRIDAY].parts:
        assert split("Anna", "Dawid") <= rules(part.rule_violations)
    assert ways(offered[SATURDAY]) == [(anchor, None, ((SATURDAY, anchor),))]
    assert ways(offered[MONDAY]) == [
        (other, "single", ((MONDAY, other),)),
        (other, "whole", ((MONDAY, other), (MONDAY, LATE))),
        (LATE, "single", ((MONDAY, LATE),)),
    ]


@pytest.mark.parametrize("kept", ["anchor", "late"])
async def test_one_role_is_exchanged_for_the_same_role_of_another_day(world, anchor, kept) -> None:
    """11-19 for 11-19, or the anchor role for the anchor role: each person
    splits a pair, so every step acknowledges the split on both days."""
    dawid_holds_the_pair_on_friday(world, anchor)
    role = LATE if kept == "anchor" else anchor

    with pytest.raises(errors.SwapRuleViolationsNotAcknowledged) as refused:
        await ask(
            world, world.dawid, role, "single", in_return=(FRIDAY, role), return_scope="single"
        )
    assert rules(refused.value.violations) == split("Anna", "Dawid")
    assert {item.days for item in refused.value.violations} == {(DAY, FRIDAY)}

    view = await ask(
        world,
        world.dawid,
        role,
        "single",
        in_return=(FRIDAY, role),
        return_scope="single",
        acknowledge=True,
    )
    assert view.slots == [(DAY, role)]
    assert view.return_slots == [(FRIDAY, role)]

    with pytest.raises(errors.SwapRuleViolationsNotAcknowledged):
        await accept(world, world.dawid, view.request.id)
    await accept(world, world.dawid, view.request.id, acknowledge=True)
    with pytest.raises(errors.SwapRuleViolationsNotAcknowledged):
        await approve(world, view.request.id)
    approved = await approve(world, view.request.id, acknowledge=True)
    assert approved.request.status == SwapStatus.approved
    assert world.roster.handed_over == [
        ((DAY, role), world.dawid.id),
        ((FRIDAY, role), world.anna.id),
    ]


@pytest.mark.parametrize(
    ("given", "scope", "taken", "return_scope", "split_day"),
    [
        ("anchor", "whole", "late", "single", FRIDAY),
        ("late", "single", "anchor", "whole", DAY),
    ],
    ids=["whole for one role", "one role for whole"],
)
async def test_mixed_scopes_split_only_the_day_taken_apart(
    world, anchor, given, scope, taken, return_scope, split_day
) -> None:
    dawid_holds_the_pair_on_friday(world, anchor)
    roles = {"anchor": anchor, "late": LATE}

    view = await ask(
        world,
        world.dawid,
        roles[given],
        scope,
        in_return=(FRIDAY, roles[taken]),
        return_scope=return_scope,
        acknowledge=True,
    )

    assert {(item.rule, item.party, item.days) for item in view.request.rule_violations} == {
        ("late_shift_anchor", "requester", (split_day,)),
        ("late_shift_anchor", "replacement", (split_day,)),
    }
    assert len(view.slots) + len(view.return_slots) == 3


async def test_on_a_day_the_requester_holds_the_other_oncall_role_only_its_late_shift_comes_back(
    world, anchor, other
) -> None:
    """Nobody holds both on-call roles on a day: Dawid's whole Friday and his
    anchor role are refused, his 11-19 alone is offered, to acknowledge."""
    dawid_holds_the_pair_on_friday(world, anchor)
    world.roster.assign(FRIDAY, other, world.anna)

    friday = (await returns(world, anchor, "whole"))[FRIDAY]

    assert (friday.role, friday.scope) == (LATE, "single")
    assert friday.blocking_violations == ()
    assert rules(friday.rule_violations) == split("Anna", "Dawid")
    assert rules(friday.warning_violations) == {("oncall_late_shift_overlap", "Anna")}
    assert [(part.role, part.scope) for part in friday.parts] == [
        (anchor, "whole"),
        (anchor, "single"),
    ]
    for part in friday.parts:
        assert ("same_day_oncall", "Anna") in rules(part.blocking_violations)

    for role, return_scope in [(anchor, None), (anchor, "whole"), (anchor, "single")]:
        with pytest.raises(errors.SwapBreaksHardRules):
            await ask(
                world,
                world.dawid,
                anchor,
                "whole",
                in_return=(FRIDAY, role),
                return_scope=return_scope,
                acknowledge=True,
            )
    view = await ask(
        world,
        world.dawid,
        anchor,
        "whole",
        in_return=(FRIDAY, LATE),
        return_scope="single",
        acknowledge=True,
    )
    assert view.return_slots == [(FRIDAY, LATE)]


async def test_the_requester_takes_back_only_what_they_may_hold(world, anchor) -> None:
    """Celina may not hold 11-19: under the anchor Dawid's whole Friday comes
    back as its anchor role alone, the exception; with 11-19 independent the
    whole day cannot come back at all."""
    world.roster.assign(THURSDAY, anchor, world.celina)
    dawid_holds_the_pair_on_friday(world, anchor)

    async def friday():
        return (await returns(world, anchor, day=THURSDAY, requester=world.celina))[FRIDAY]

    assert ways(await friday()) == [(anchor, "whole", ((FRIDAY, anchor),))]
    assert {item.rule for item in (await friday()).warning_violations} == {"late_shift_anchor"}

    world.policy.anchor = LateShiftAnchor.independent
    assert ways(await friday()) == [(anchor, "single", ((FRIDAY, anchor),))]
    with pytest.raises(errors.RequesterNotEligible):
        await ask(
            world,
            world.dawid,
            anchor,
            day=THURSDAY,
            requester=world.celina,
            in_return=(FRIDAY, anchor),
            return_scope="whole",
        )


async def test_the_impact_projects_the_scope_taken_in_return(world, anchor) -> None:
    dawid_holds_the_pair_on_friday(world, anchor)

    async def impact(return_scope):
        return await preview_swap_impact(
            SwapImpactQuery(
                account(world.anna),
                DAY,
                LATE,
                world.dawid.id,
                in_return=(FRIDAY, LATE),
                scope="single",
                return_scope=return_scope,
            ),
            world.swaps,
        )

    late_for_late = await impact("single")
    for side in (late_for_late.requester, late_for_late.replacement):
        assert side.after.late_shift.actual == side.before.late_shift.actual
        assert getattr(side.after, anchor).actual == getattr(side.before, anchor).actual

    late_for_whole = await impact("whole")
    for side, change in ((late_for_whole.requester, 1), (late_for_whole.replacement, -1)):
        assert side.after.late_shift.actual == side.before.late_shift.actual
        assert getattr(side.after, anchor).actual == getattr(side.before, anchor).actual + change
