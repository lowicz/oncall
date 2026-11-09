"""Coordinator correction use cases against in-memory ports: no database, no HTTP."""

import uuid
from dataclasses import replace
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

import pytest

from oncall.domain.overrides import errors
from oncall.domain.overrides.models import (
    UNSTAFFED,
    BatchOverrideCheck,
    BatchOverrideInput,
    BatchOverrideKind,
    BatchOverrideLine,
    OverrideCheck,
    OverrideInput,
    OverrideMove,
)
from oncall.domain.overrides.use_cases import (
    check_batch_override,
    check_override,
    override_duties_in_batch,
    override_duty,
)
from oncall.domain.team import Actor
from oncall.domain.vocabulary import (
    AssignmentRole,
    LateShiftAnchor,
    RotationMode,
    ScheduleStatus,
    UserRole,
)
from tests.domain.fakes import World, member

DAY = date(2030, 3, 13)
SATURDAY = date(2030, 3, 16)
TODAY = DAY - timedelta(days=7)
WARSAW = ZoneInfo("Europe/Warsaw")


def at(day: date, hour: int, minute: int = 0) -> datetime:
    """A wall-clock instant in Warsaw, where the duties run."""
    return datetime.combine(day, time(hour, minute), WARSAW)


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


def override(world: World, replacement, *, role=AssignmentRole.primary, day=DAY, now=None, **extra):
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
        now=now or at(TODAY, 12),
    )


async def test_an_override_hands_the_slot_over_and_journals_who_it_was_taken_from(world) -> None:
    result = await override(world, world.ewa, reason="choroba")

    assert result.assignee_name == "Ewa"
    assert world.roster.handed_over == [((DAY, AssignmentRole.primary), world.ewa.id)]
    assert world.roster.schedule_ref.version == 2
    (name, call) = world.journal.events[0]
    assert name == "duty_overridden"
    assert call["changes"] == [(DAY, AssignmentRole.primary, "Anna", "Ewa")]
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
    (change,) = world.journal.events[0][1]["changes"]
    assert change == (DAY, AssignmentRole.primary, UNSTAFFED, "Ewa")


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
    with pytest.raises(errors.RosterChangedMeanwhile):
        await override(world, world.ewa, expected_version=7)
    assert world.roster.handed_over == []
    assert world.journal.events == []


async def test_a_historical_correction_needs_a_reason(world) -> None:
    # A working day's night on-call ends at 09:00 the next morning.
    with pytest.raises(errors.HistoricalCorrectionNeedsReason):
        await override(world, world.ewa, now=at(DAY + timedelta(days=1), 9), reason="krótko")
    assert world.roster.schedule_ref.version == 1

    await override(world, world.ewa, now=at(DAY + timedelta(days=1), 9), reason="Korekta po fakcie")
    assert world.journal.events[0][1]["historical"] is True


async def test_a_night_duty_still_in_force_is_corrected_without_a_reason(world) -> None:
    await override(world, world.ewa, now=at(DAY + timedelta(days=1), 8, 59))

    assert world.journal.events[0][1]["historical"] is False


async def test_11_19_is_past_once_its_evening_comes(world) -> None:
    late = {"role": AssignmentRole.late_shift, "acknowledge_rule_violations": True}
    await override(world, world.ewa, now=at(DAY, 18, 59), **late)
    with pytest.raises(errors.HistoricalCorrectionNeedsReason):
        await override(world, world.anna, now=at(DAY, 19), **late)


async def test_a_night_duty_carrying_an_ended_11_19_needs_a_reason(world) -> None:
    # Bartek holds SECONDARY and 11-19, so the anchor moves both.
    with pytest.raises(errors.HistoricalCorrectionNeedsReason):
        await override(world, world.ewa, role=AssignmentRole.secondary, now=at(DAY, 22))
    assert world.roster.schedule_ref.version == 1


@pytest.mark.parametrize("acknowledged", [None, False])
async def test_a_correction_that_breaks_rules_is_refused_without_acknowledgement(
    world, acknowledged
) -> None:
    for offset in (1, 2, 3):
        world.roster.assign(DAY - timedelta(days=offset), AssignmentRole.primary, world.ewa)
    extra = {} if acknowledged is None else {"acknowledge_rule_violations": acknowledged}

    with pytest.raises(errors.RuleViolationsNotAcknowledged) as refused:
        await override(world, world.ewa, **extra)

    assert "max_consecutive" in {item.rule for item in refused.value.violations}
    assert world.roster.handed_over == []
    assert world.roster.schedule_ref.version == 1
    assert world.journal.events == []


async def test_an_acknowledged_correction_goes_through_with_the_violations(world) -> None:
    for offset in (1, 2, 3):
        world.roster.assign(DAY - timedelta(days=offset), AssignmentRole.primary, world.ewa)

    result = await override(world, world.ewa, acknowledge_rule_violations=True)

    assert "max_consecutive" in {item.rule for item in result.violations}
    assert world.journal.events[0][1]["violations"] == list(result.violations)


async def test_a_clean_correction_needs_no_acknowledgement(world) -> None:
    result = await override(world, world.ewa, acknowledge_rule_violations=False)

    assert result.violations == ()
    assert world.roster.schedule_ref.version == 2


def batch(world: World, *lines, reason="Odejście z zespołu", version=None, acknowledged=False):
    return override_duties_in_batch(
        BatchOverrideInput(
            actor=COORDINATOR,
            schedule_id=world.roster.schedule_ref.id,
            expected_version=version or world.roster.schedule_ref.version,
            lines=tuple(lines),
            reason=reason,
            acknowledge_rule_violations=acknowledged,
        ),
        world.overrides,
    )


async def test_a_batch_rewrites_every_slot_as_one_version(world) -> None:
    results = await batch(
        world,
        BatchOverrideLine(DAY, AssignmentRole.primary, world.ewa.id),
        BatchOverrideLine(DAY, AssignmentRole.late_shift, world.anna.id),
        acknowledged=True,
    )

    assert [item.assignee_name for item in results] == ["Ewa", "Anna"]
    assert world.roster.schedule_ref.version == 2
    assert world.journal.events[0][1]["moves"] == [
        OverrideMove(DAY, AssignmentRole.primary, "Anna"),
        OverrideMove(DAY, AssignmentRole.late_shift, "Bartek"),
    ]
    # The journal also learns who took each slot, so it can tell both sides.
    assert world.journal.events[0][1]["changes"] == [
        (DAY, AssignmentRole.primary, "Anna", "Ewa"),
        (DAY, AssignmentRole.late_shift, "Bartek", "Anna"),
    ]


async def test_a_batch_that_breaks_rules_is_refused_without_acknowledgement(world) -> None:
    lines = (
        BatchOverrideLine(DAY, AssignmentRole.primary, world.ewa.id),
        BatchOverrideLine(DAY, AssignmentRole.late_shift, world.anna.id),
    )

    with pytest.raises(errors.RuleViolationsNotAcknowledged) as refused:
        await batch(world, *lines)

    assert "late_shift_anchor" in {item.rule for item in refused.value.violations}
    assert world.roster.handed_over == []
    assert world.roster.schedule_ref.version == 1
    assert world.journal.events == []


async def test_a_batch_under_weekly_rotation_reports_no_rest_violations(world) -> None:
    """A batch correction is checked in one state, and that check takes the
    rotation like every other: weekly rotation has no rest rules to break."""
    for offset in (1, 2, 3):
        world.roster.assign(DAY - timedelta(days=offset), AssignmentRole.primary, world.ewa)
    world.policy.mode = RotationMode.weekly

    results = await batch(world, BatchOverrideLine(DAY, AssignmentRole.primary, world.ewa.id))

    assert [item.assignee_name for item in results] == ["Ewa"]
    assert world.journal.events[0][1]["violations"] == []


async def test_a_batch_refuses_repeated_slots_and_days_of_another_publication(
    world, monkeypatch
) -> None:
    line = BatchOverrideLine(DAY, AssignmentRole.primary, world.ewa.id)
    with pytest.raises(errors.RepeatedSlotInBatch):
        await batch(world, line, line)

    async def no_publication(day):
        return None

    monkeypatch.setattr(world.roster, "latest_publication_covering", no_publication)
    with pytest.raises(errors.ScheduleSlotNotFound):
        await batch(
            world, BatchOverrideLine(DAY + timedelta(days=1), AssignmentRole.primary, world.ewa.id)
        )
    assert world.roster.schedule_ref.version == 1


async def test_a_batch_fills_an_unstaffed_slot_of_its_schedule(world) -> None:
    empty_day = DAY + timedelta(days=1)

    await batch(world, BatchOverrideLine(empty_day, AssignmentRole.primary, world.ewa.id))

    assert world.roster.handed_over == [((empty_day, AssignmentRole.primary), world.ewa.id)]
    assert world.journal.events[0][1]["moves"] == [
        OverrideMove(empty_day, AssignmentRole.primary, UNSTAFFED)
    ]


async def test_a_batch_check_needs_at_least_one_line(world) -> None:
    with pytest.raises(errors.EmptyBatch):
        await check_batch_override(
            [BatchOverrideCheck(world.roster.schedule_ref.id, ())], world.overrides
        )


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


async def test_an_override_needs_a_published_schedule(world) -> None:
    world.roster.schedule_ref.status = ScheduleStatus.draft

    with pytest.raises(errors.PublishedScheduleNotFound):
        await override(world, world.ewa)

    assert world.roster.handed_over == []
    assert world.journal.events == []


async def test_a_batch_needs_a_published_schedule(world) -> None:
    world.roster.schedule_ref.status = ScheduleStatus.draft

    with pytest.raises(errors.PublishedScheduleNotFound):
        await batch(world, BatchOverrideLine(DAY, AssignmentRole.primary, world.ewa.id))

    assert world.roster.schedule_ref.version == 1


@pytest.mark.parametrize(
    ("replacement_kwargs", "error"),
    [
        ({"roles": (AssignmentRole.secondary,)}, errors.PersonNotEligible),
        ({"unavailable": (DAY,)}, errors.PersonUnavailable),
    ],
)
async def test_every_batch_replacement_must_be_able_to_serve(
    world, replacement_kwargs, error
) -> None:
    filip = world.team.add(member("Filip", **replacement_kwargs))

    with pytest.raises(error):
        await batch(world, BatchOverrideLine(DAY, AssignmentRole.primary, filip.id))

    assert world.roster.handed_over == []
    assert world.roster.schedule_ref.version == 1


async def test_a_batch_refuses_a_replacement_who_does_not_exist(world) -> None:
    with pytest.raises(errors.PersonNotEligible):
        await batch(world, BatchOverrideLine(DAY, AssignmentRole.primary, uuid.uuid4()))


async def test_the_check_of_a_primary_slot_moves_only_that_slot(world) -> None:
    for offset in (1, 2, 3):
        world.roster.assign(DAY - timedelta(days=offset), AssignmentRole.primary, world.ewa)

    violations = await check_override(
        OverrideCheck(DAY, AssignmentRole.primary, world.ewa.id), world.overrides
    )

    assert "max_consecutive" in {item.rule for item in violations}


async def test_a_late_shift_held_by_someone_else_is_not_coupled(world) -> None:
    world.roster.assign(DAY, AssignmentRole.late_shift, world.anna)

    violations = await check_override(
        OverrideCheck(DAY, AssignmentRole.secondary, world.ewa.id), world.overrides
    )
    result = await override(
        world, world.ewa, role=AssignmentRole.secondary, acknowledge_rule_violations=True
    )

    assert violations == list(result.violations)
    assert world.roster.handed_over == [((DAY, AssignmentRole.secondary), world.ewa.id)]
    assert world.journal.events[0][1]["moves"] == [
        OverrideMove(DAY, AssignmentRole.secondary, "Bartek")
    ]


async def test_a_late_shift_override_has_no_opposite_role_to_collide_with(world) -> None:
    result = await override(
        world, world.anna, role=AssignmentRole.late_shift, acknowledge_rule_violations=True
    )

    assert result.assignee_name == "Anna"
    assert world.roster.handed_over == [((DAY, AssignmentRole.late_shift), world.anna.id)]


# --- role swap ----------------------------------------------------------------


def role_swap(
    world: World, *, with_late_shift=True, reason=None, now=None, lines=None, acknowledged=False
):
    """Anna (PRIMARY) and Bartek (SECONDARY and 11-19) trade places."""
    return override_duties_in_batch(
        BatchOverrideInput(
            actor=COORDINATOR,
            schedule_id=world.roster.schedule_ref.id,
            expected_version=world.roster.schedule_ref.version,
            lines=lines
            or (
                BatchOverrideLine(DAY, AssignmentRole.primary, world.bartek.id),
                BatchOverrideLine(DAY, AssignmentRole.secondary, world.anna.id, with_late_shift),
            ),
            reason=reason,
            kind=BatchOverrideKind.role_swap,
            acknowledge_rule_violations=acknowledged,
        ),
        world.overrides,
        now=now or at(TODAY, 12),
    )


async def test_a_role_swap_trades_places_with_11_19_as_one_decision(world) -> None:
    results = await role_swap(world)

    assert [(item.role, item.assignee_name) for item in results] == [
        (AssignmentRole.primary, "Bartek"),
        (AssignmentRole.secondary, "Anna"),
        (AssignmentRole.late_shift, "Anna"),
    ]
    assert world.roster.schedule_ref.version == 2
    ((name, call),) = world.journal.events
    assert name == "duties_overridden_in_batch"
    assert call["kind"] is BatchOverrideKind.role_swap
    assert call["reason"] is None
    assert call["violations"] == []
    assert call["changes"] == [
        (DAY, AssignmentRole.primary, "Anna", "Bartek"),
        (DAY, AssignmentRole.secondary, "Bartek", "Anna"),
        (DAY, AssignmentRole.late_shift, "Bartek", "Anna"),
    ]


async def test_a_role_swap_may_leave_11_19_where_it_is(world) -> None:
    with pytest.raises(errors.RuleViolationsNotAcknowledged) as refused:
        await role_swap(world, with_late_shift=False)
    assert "late_shift_anchor" in {item.rule for item in refused.value.violations}

    await role_swap(world, with_late_shift=False, acknowledged=True)
    assert [slot for slot, _ in world.roster.handed_over] == [
        (DAY, AssignmentRole.primary),
        (DAY, AssignmentRole.secondary),
    ]


async def test_a_role_swap_of_a_past_day_needs_a_reason(world) -> None:
    after = at(DAY + timedelta(days=1), 9)
    with pytest.raises(errors.HistoricalCorrectionNeedsReason):
        await role_swap(world, now=after, reason="krótko")
    assert world.roster.schedule_ref.version == 1

    await role_swap(world, now=after, reason="Zamiana uzgodniona po fakcie")
    assert world.journal.events[0][1]["reason"] == "Zamiana uzgodniona po fakcie"


async def test_a_role_swap_decides_past_per_role(world) -> None:
    night = at(DAY, 22)
    # 11-19 ended at 19:00; the night's on-call roles are still in force.
    with pytest.raises(errors.HistoricalCorrectionNeedsReason):
        await role_swap(world, now=night)

    await role_swap(world, now=night, with_late_shift=False, acknowledged=True)
    assert world.roster.schedule_ref.version == 2


@pytest.mark.parametrize(
    "lines",
    [
        # A third person is a correction, not a swap.
        lambda world: (
            BatchOverrideLine(DAY, AssignmentRole.primary, world.ewa.id),
            BatchOverrideLine(DAY, AssignmentRole.secondary, world.anna.id),
        ),
        lambda world: (BatchOverrideLine(DAY, AssignmentRole.primary, world.bartek.id),),
        lambda world: (
            BatchOverrideLine(DAY, AssignmentRole.primary, world.bartek.id),
            BatchOverrideLine(DAY, AssignmentRole.late_shift, world.anna.id),
        ),
    ],
    ids=["third person", "one line", "not the on-call pair"],
)
async def test_a_role_swap_is_only_a_swap_of_the_on_call_pair(world, lines) -> None:
    with pytest.raises(errors.NotARoleSwap):
        await role_swap(world, lines=lines(world))
    assert world.roster.handed_over == []


@pytest.mark.parametrize(
    "setup",
    [
        lambda world: setattr(world.policy, "anchor", LateShiftAnchor.independent),
        lambda world: world.roster.assign(DAY, AssignmentRole.late_shift, world.ewa),
        lambda world: world.team.by_id.__setitem__(
            world.anna.id,
            replace(
                world.anna,
                eligibility=tuple(
                    period
                    for period in world.anna.eligibility
                    if period.role != AssignmentRole.late_shift
                ),
            ),
        ),
    ],
    ids=["independent anchor", "11-19 held by someone else", "replacement not eligible"],
)
async def test_11_19_goes_along_only_where_a_correction_would_carry_it(world, setup) -> None:
    setup(world)
    with pytest.raises(errors.LateShiftNotCoupled):
        await role_swap(world)
    assert world.roster.schedule_ref.version == 1


async def test_11_19_goes_along_only_with_a_known_replacement(world) -> None:
    with pytest.raises(errors.LateShiftNotCoupled):
        await role_swap(
            world,
            lines=(
                BatchOverrideLine(DAY, AssignmentRole.primary, world.bartek.id),
                BatchOverrideLine(DAY, AssignmentRole.secondary, uuid.uuid4(), True),
            ),
        )


async def test_11_19_taken_along_and_listed_too_is_a_repeated_slot(world) -> None:
    with pytest.raises(errors.RepeatedSlotInBatch):
        await batch(
            world,
            BatchOverrideLine(DAY, AssignmentRole.secondary, world.ewa.id, True),
            BatchOverrideLine(DAY, AssignmentRole.late_shift, world.ewa.id),
        )


async def test_the_batch_check_sees_the_swap_as_the_state_after_both_moves(world) -> None:
    """PRIMARY and SECONDARY swapped is no `same_day_oncall`, though each move
    on its own would put one person on both on-call roles."""
    swap = (
        BatchOverrideLine(DAY, AssignmentRole.primary, world.bartek.id),
        BatchOverrideLine(DAY, AssignmentRole.secondary, world.anna.id, True),
    )
    schedule_id = world.roster.schedule_ref.id

    assert (
        await check_batch_override([BatchOverrideCheck(schedule_id, swap)], world.overrides) == []
    )
    alone = await check_batch_override([BatchOverrideCheck(schedule_id, swap[:1])], world.overrides)
    assert "same_day_oncall" in {item.rule for item in alone}
