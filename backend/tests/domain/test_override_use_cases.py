"""Coordinator correction use cases against in-memory ports: no database, no HTTP."""

import uuid
from datetime import date, timedelta

import pytest

from oncall.domain.overrides import errors
from oncall.domain.overrides.models import (
    UNSTAFFED,
    BatchOverrideInput,
    BatchOverrideLine,
    OverrideCheck,
    OverrideInput,
    OverrideMove,
)
from oncall.domain.overrides.use_cases import (
    check_override,
    override_duties_in_batch,
    override_duty,
)
from oncall.domain.team import Actor
from oncall.domain.vocabulary import AssignmentRole, LateShiftAnchor, UserRole
from tests.domain.fakes import World, member

DAY = date(2030, 3, 13)
SATURDAY = date(2030, 3, 16)
TODAY = DAY - timedelta(days=7)
COORDINATOR = Actor(uuid.uuid4(), "Koordynatorka", UserRole.coordinator)


@pytest.fixture
def world() -> World:
    world = World()
    world.anna = world.team.add(member("Anna"))
    world.bartek = world.team.add(member("Bartek"))
    world.ewa = world.team.add(member("Ewa"))
    world.roster.assign(DAY, AssignmentRole.primary, world.anna)
    world.roster.assign(DAY, AssignmentRole.secondary, world.bartek)
    world.roster.assign(DAY, AssignmentRole.late_shift, world.bartek)
    return world


def override(world: World, replacement, *, role=AssignmentRole.primary, day=DAY, **extra):
    return override_duty(
        OverrideInput(
            actor=COORDINATOR,
            service_date=day,
            role=role,
            replacement_member_id=replacement.id,
            expected_version=extra.pop("expected_version", world.roster.schedule_ref.version),
            **extra,
        ),
        world.overrides,
        today=TODAY,
    )


async def test_an_override_hands_the_slot_over_and_journals_who_it_was_taken_from(world) -> None:
    result = await override(world, world.ewa, reason="choroba")

    assert result.assignee_name == "Ewa"
    assert world.roster.handed_over == [((DAY, AssignmentRole.primary), world.ewa.id)]
    assert world.roster.schedule_ref.version == 2
    (name, call) = world.journal.events[0]
    assert name == "duty_overridden"
    assert call["previous_name"] == "Anna"
    assert call["historical"] is False
    assert call["moves"] == [OverrideMove(DAY, AssignmentRole.primary, "Anna")]


async def test_the_anchor_role_carries_late_shift_when_one_person_holds_both(world) -> None:
    await override(world, world.ewa, role=AssignmentRole.secondary)

    assert [slot for slot, _ in world.roster.handed_over] == [
        (DAY, AssignmentRole.secondary),
        (DAY, AssignmentRole.late_shift),
    ]
    assert world.journal.events[0][1]["moves"][1] == OverrideMove(
        DAY, AssignmentRole.late_shift, "Bartek"
    )


async def test_an_independent_late_shift_stays_put(world) -> None:
    world.policy.anchor = LateShiftAnchor.independent
    await override(world, world.ewa, role=AssignmentRole.secondary)
    assert [slot for slot, _ in world.roster.handed_over] == [(DAY, AssignmentRole.secondary)]


async def test_an_empty_slot_is_staffed_and_journalled_as_unstaffed(world) -> None:
    del world.roster.schedule_ref.slots[(DAY, AssignmentRole.primary)]
    await override(world, world.ewa)
    assert world.journal.events[0][1]["previous_name"] == UNSTAFFED


async def test_late_shift_exists_on_working_days_only(world) -> None:
    with pytest.raises(errors.LateShiftOnlyOnWorkingDays):
        await override(world, world.ewa, role=AssignmentRole.late_shift, day=SATURDAY)
    checked = await check_override(
        OverrideCheck(SATURDAY, AssignmentRole.late_shift, world.ewa.id), world.overrides
    )
    assert checked == []


@pytest.mark.parametrize(
    ("replacement_kwargs", "error"),
    [
        ({"roles": (AssignmentRole.secondary,)}, errors.PersonNotEligible),
        ({"unavailable": (DAY,)}, errors.PersonUnavailable),
    ],
)
async def test_the_person_must_be_able_to_serve(world, replacement_kwargs, error) -> None:
    with pytest.raises(error):
        await override(world, world.team.add(member("Filip", **replacement_kwargs)))
    assert world.roster.schedule_ref.version == 1


async def test_nobody_is_put_on_a_role_they_already_hold(world) -> None:
    with pytest.raises(errors.PersonAlreadyHoldsRole):
        await override(world, world.anna)


async def test_nobody_gets_both_oncall_roles(world) -> None:
    with pytest.raises(errors.PersonAlreadyOnCall):
        await override(world, world.bartek)


async def test_a_stale_version_changes_nothing(world) -> None:
    with pytest.raises(errors.RosterChangedMeanwhile) as refused:
        await override(world, world.ewa, expected_version=7)
    assert refused.value.expected_version == 7
    assert world.roster.handed_over == []
    assert world.journal.events == []


async def test_a_historical_correction_needs_a_reason(world) -> None:
    with pytest.raises(errors.HistoricalCorrectionNeedsReason):
        await override(world, world.ewa, day=TODAY - timedelta(days=1), reason="krótko")


async def test_a_correction_that_breaks_rules_goes_through_with_the_violations(world) -> None:
    for offset in (1, 2, 3):
        world.roster.assign(DAY - timedelta(days=offset), AssignmentRole.primary, world.ewa)

    result = await override(world, world.ewa)

    assert "max_consecutive" in {item.rule for item in result.violations}
    assert world.journal.events[0][1]["violations"] == list(result.violations)


def batch(world: World, *lines, reason="Odejście z zespołu", version=None):
    return override_duties_in_batch(
        BatchOverrideInput(
            actor=COORDINATOR,
            schedule_id=world.roster.schedule_ref.id,
            expected_version=version or world.roster.schedule_ref.version,
            lines=tuple(lines),
            reason=reason,
        ),
        world.overrides,
    )


async def test_a_batch_rewrites_every_slot_as_one_version(world) -> None:
    results = await batch(
        world,
        BatchOverrideLine(DAY, AssignmentRole.primary, world.ewa.id),
        BatchOverrideLine(DAY, AssignmentRole.late_shift, world.anna.id),
    )

    assert [item.assignee_name for item in results] == ["Ewa", "Anna"]
    assert world.roster.schedule_ref.version == 2
    assert world.journal.events[0][1]["moves"] == [
        OverrideMove(DAY, AssignmentRole.primary, "Anna"),
        OverrideMove(DAY, AssignmentRole.late_shift, "Bartek"),
    ]


async def test_a_batch_refuses_repeated_and_missing_slots(world) -> None:
    line = BatchOverrideLine(DAY, AssignmentRole.primary, world.ewa.id)
    with pytest.raises(errors.RepeatedSlotInBatch):
        await batch(world, line, line)
    with pytest.raises(errors.ScheduleSlotNotFound):
        await batch(
            world, BatchOverrideLine(DAY + timedelta(days=1), AssignmentRole.primary, world.ewa.id)
        )
    assert world.roster.schedule_ref.version == 1


async def test_a_batch_needs_lines_and_a_reason(world) -> None:
    with pytest.raises(errors.EmptyBatch):
        await batch(world)
    with pytest.raises(errors.BatchCorrectionNeedsReason):
        await batch(
            world, BatchOverrideLine(DAY, AssignmentRole.primary, world.ewa.id), reason="bo tak"
        )


async def test_a_stale_batch_changes_nothing(world) -> None:
    with pytest.raises(errors.RosterChangedMeanwhile):
        await batch(world, BatchOverrideLine(DAY, AssignmentRole.primary, world.ewa.id), version=5)
    assert world.roster.handed_over == []


async def test_the_check_projects_the_same_coupled_move_as_the_write(world) -> None:
    for offset in (1, 2, 3):
        world.roster.assign(DAY - timedelta(days=offset), AssignmentRole.late_shift, world.ewa)
    violations = await check_override(
        OverrideCheck(DAY, AssignmentRole.secondary, world.ewa.id, world.roster.schedule_ref.id),
        world.overrides,
    )
    result = await override(world, world.ewa, role=AssignmentRole.secondary)
    assert violations == list(result.violations)


async def test_the_check_names_a_person_who_does_not_exist(world) -> None:
    with pytest.raises(errors.PersonNotFound):
        await check_override(
            OverrideCheck(DAY, AssignmentRole.primary, uuid.uuid4()), world.overrides
        )
