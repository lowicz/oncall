"""Availability use cases against in-memory ports: no database, no HTTP."""

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest

from oncall.domain.availability import errors
from oncall.domain.availability.models import (
    AvailabilityDeclaration,
    AvailabilityEntry,
    AvailabilityQuery,
    AvailabilityRangeReplacement,
    AvailabilityWithdrawal,
    MemberById,
    OwnMember,
)
from oncall.domain.availability.use_cases import (
    declare_availability,
    list_availability,
    replace_availability_range,
    withdraw_availability,
)
from oncall.domain.errors import NotATeamMember
from oncall.domain.team import Actor
from oncall.domain.vocabulary import AssignmentRole, AvailabilityKind, UserRole
from tests.domain.fakes import World, member

DAY = date(2030, 3, 13)
TODAY = DAY - timedelta(days=7)


@pytest.fixture
def world() -> World:
    world = World()
    world.anna = world.team.add(member("Anna"))
    world.coordinator = Actor(uuid.uuid4(), "Koordynatorka", UserRole.coordinator)
    return world


def own(world: World) -> Actor:
    return Actor(world.anna.user_id, "Anna", UserRole.member)


def declare(world: World, actor: Actor, target, kind=AvailabilityKind.prefer_not, **dates):
    starts_on = dates.get("starts_on", DAY)
    ends_on = dates.get("ends_on", DAY + timedelta(days=2))
    return declare_availability(
        AvailabilityDeclaration(actor, target, kind, starts_on, ends_on, note="urlop"),
        world.availability_writes,
        today=TODAY,
    )


def stored(world: World, kind: AvailabilityKind, starts_on: date, ends_on: date):
    return world.ledger.put(
        AvailabilityEntry(
            id=uuid.uuid4(),
            member_id=world.anna.id,
            kind=kind,
            starts_on=starts_on,
            ends_on=ends_on,
            note=None,
            created_at=datetime.now(UTC),
            created_by_user_id=world.anna.user_id,
            created_by_name="Anna",
        )
    )


async def test_a_member_declares_their_own_availability(world) -> None:
    declared = await declare(world, own(world), OwnMember())

    assert declared.on_behalf is False
    assert declared.warning is None
    assert declared.entry.member_id == world.anna.id
    assert declared.entry.filed_for(world.anna) is None
    assert world.journal.events[0][1]["on_behalf"] is False


async def test_a_coordinator_files_for_a_member_and_is_named_on_the_entry(world) -> None:
    declared = await declare(world, world.coordinator, MemberById(world.anna.id))

    assert declared.on_behalf is True
    assert declared.entry.created_by_user_id == world.coordinator.user_id
    assert declared.entry.filed_for(world.anna) == "filer"


async def test_an_unknown_member_is_not_found(world) -> None:
    with pytest.raises(errors.TeamMemberNotFound):
        await declare(world, world.coordinator, MemberById(uuid.uuid4()))


async def test_an_account_without_a_member_has_no_availability(world) -> None:
    with pytest.raises(NotATeamMember):
        await declare(world, world.coordinator, OwnMember())


async def test_the_range_rules_hold_outside_http_too(world) -> None:
    with pytest.raises(errors.AvailabilityRangeReversed):
        await declare(world, own(world), OwnMember(), starts_on=DAY, ends_on=DAY - timedelta(1))
    with pytest.raises(errors.AvailabilityRangeTooLong):
        await declare(world, own(world), OwnMember(), ends_on=DAY + timedelta(days=367))


async def test_an_entry_wholly_in_the_past_is_refused(world) -> None:
    with pytest.raises(errors.AvailabilityInThePast):
        await declare(
            world,
            own(world),
            OwnMember(),
            starts_on=TODAY - timedelta(days=3),
            ends_on=TODAY - timedelta(days=1),
        )


async def test_an_identical_entry_and_an_overlapping_one_are_told_apart(world) -> None:
    stored(world, AvailabilityKind.prefer_not, DAY, DAY + timedelta(days=2))

    with pytest.raises(errors.AvailabilityAlreadyExists):
        await declare(world, own(world), OwnMember())
    with pytest.raises(errors.AvailabilityOverlaps):
        await declare(world, own(world), OwnMember(), kind=AvailabilityKind.unavailable)

    assert world.ledger.pending is None


async def test_a_hard_unavailability_over_a_duty_warns_and_names_the_duties(world) -> None:
    world.roster.assign(DAY + timedelta(days=1), AssignmentRole.primary, world.anna)

    own_entry = await declare(world, own(world), OwnMember(), kind=AvailabilityKind.unavailable)
    assert own_entry.warning.startswith("Masz w tym czasie dyżur.")
    assert [duty.slot for duty in own_entry.duty_conflicts] == [
        (DAY + timedelta(days=1), AssignmentRole.primary)
    ]

    later = DAY + timedelta(days=1)
    world.ledger.by_id.clear()
    on_behalf = await declare(
        world,
        world.coordinator,
        MemberById(world.anna.id),
        kind=AvailabilityKind.unavailable,
        starts_on=later,
        ends_on=later,
    )
    assert on_behalf.warning.startswith("Anna ma w tym czasie dyżur.")


async def test_a_soft_preference_never_looks_for_duty_conflicts(world) -> None:
    world.roster.assign(DAY, AssignmentRole.primary, world.anna)
    declared = await declare(world, own(world), OwnMember(), kind=AvailabilityKind.prefer)
    assert declared.duty_conflicts == ()
    assert declared.warning is None


async def test_replacing_a_range_cuts_existing_entries_and_paints_once(world) -> None:
    original = stored(
        world,
        AvailabilityKind.prefer,
        DAY - timedelta(days=2),
        DAY + timedelta(days=2),
    )

    result = await replace_availability_range(
        AvailabilityRangeReplacement(
            actor=own(world),
            member=OwnMember(),
            starts_on=DAY,
            ends_on=DAY,
            kind=AvailabilityKind.unavailable,
            note="urlop",
        ),
        world.availability_writes,
        today=TODAY,
    )

    assert world.ledger.removed == [original.id]
    assert [
        (entry.kind, entry.starts_on, entry.ends_on, entry.note)
        for entry in sorted(world.ledger.by_id.values(), key=lambda entry: entry.starts_on)
    ] == [
        (AvailabilityKind.prefer, DAY - timedelta(days=2), DAY - timedelta(days=1), None),
        (AvailabilityKind.unavailable, DAY, DAY, "urlop"),
        (AvailabilityKind.prefer, DAY + timedelta(days=1), DAY + timedelta(days=2), None),
    ]
    assert result is not None
    assert result.entry.kind == AvailabilityKind.unavailable
    assert world.journal.names == ["withdrawn", "declared", "declared", "declared"]


async def test_clearing_a_range_can_leave_no_painted_entry(world) -> None:
    original = stored(world, AvailabilityKind.prefer_not, DAY, DAY)

    result = await replace_availability_range(
        AvailabilityRangeReplacement(own(world), OwnMember(), DAY, DAY, None),
        world.availability_writes,
        today=TODAY,
    )

    assert result is None
    assert world.ledger.removed == [original.id]
    assert world.ledger.by_id == {}


async def test_replacing_a_range_does_not_recreate_a_piece_wholly_in_the_past(world) -> None:
    stored(world, AvailabilityKind.prefer, TODAY - timedelta(days=2), DAY)

    await replace_availability_range(
        AvailabilityRangeReplacement(
            own(world),
            OwnMember(),
            TODAY - timedelta(days=1),
            DAY - timedelta(days=1),
            None,
        ),
        world.availability_writes,
        today=TODAY,
    )

    assert [(entry.starts_on, entry.ends_on) for entry in world.ledger.by_id.values()] == [
        (DAY, DAY)
    ]


async def test_replacing_an_invalid_range_changes_nothing(world) -> None:
    original = stored(world, AvailabilityKind.prefer, DAY, DAY)

    with pytest.raises(errors.AvailabilityRangeReversed):
        await replace_availability_range(
            AvailabilityRangeReplacement(own(world), OwnMember(), DAY, DAY - timedelta(1), None),
            world.availability_writes,
            today=TODAY,
        )

    assert world.ledger.by_id == {original.id: original}
    assert world.journal.events == []


async def test_withdrawing_removes_only_the_members_own_entry(world) -> None:
    entry = stored(world, AvailabilityKind.prefer, DAY, DAY)
    other = world.team.add(member("Bartek"))

    with pytest.raises(errors.AvailabilityEntryNotFound):
        await withdraw_availability(
            AvailabilityWithdrawal(world.coordinator, MemberById(other.id), entry.id),
            world.availability_writes,
        )
    await withdraw_availability(
        AvailabilityWithdrawal(world.coordinator, MemberById(world.anna.id), entry.id),
        world.availability_writes,
    )

    assert world.ledger.removed == [entry.id]
    assert world.journal.events[-1][0] == "withdrawn"
    assert world.journal.events[-1][1]["on_behalf"] is True


async def test_listing_resolves_whose_entries_are_read(world) -> None:
    stored(world, AvailabilityKind.prefer, DAY, DAY)
    result = await list_availability(
        AvailabilityQuery(own(world), OwnMember()), world.availability_reads
    )
    assert result.member == world.anna
    assert len(result.entries) == 1
