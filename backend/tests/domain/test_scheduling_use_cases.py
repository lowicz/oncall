"""Scheduling use cases against in-memory ports: no database, no HTTP, no solver."""

import uuid
from dataclasses import replace
from datetime import UTC, date, datetime, timedelta

import pytest

from oncall.domain.roster import Duty
from oncall.domain.scheduling import errors
from oncall.domain.scheduling.drafts import (
    correct_draft,
    delete_schedule,
    propose,
    withdraw,
)
from oncall.domain.scheduling.generation import generate_draft, queue_generation
from oncall.domain.scheduling.models import (
    DraftCorrection,
    GenerationRequest,
    PendingSwap,
    PolicyChange,
    PublicationRequest,
    Transition,
)
from oncall.domain.scheduling.policy import change_policy
from oncall.domain.scheduling.publication import (
    override_original_assignees,
    preview_publication,
    publish,
    stale_changes_count,
)
from oncall.domain.scheduling.queries import compare_variants
from oncall.domain.scheduling.solver import GeneratedAssignment, SolverResult
from oncall.domain.team import Actor, AvailabilityPeriod
from oncall.domain.vocabulary import (
    AssignmentRole,
    AvailabilityKind,
    RotationMode,
    ScheduleStatus,
    UserRole,
)
from tests.domain.fakes import member
from tests.domain.scheduling_fakes import SchedulingWorld, complete_schedule, queued_run

MONDAY = date(2030, 3, 4)
SATURDAY = date(2030, 3, 9)
NOW = datetime(2030, 3, 4, 8, tzinfo=UTC)
COORDINATOR = Actor(uuid.uuid4(), "Koordynatorka", UserRole.coordinator)


@pytest.fixture
def world() -> SchedulingWorld:
    world = SchedulingWorld()
    world.anna = world.team.add(member("Anna"))
    world.bartek = world.team.add(member("Bartek"))
    world.celina = world.team.add(member("Celina"))
    world.dawid = world.team.add(member("Dawid"))
    return world


def _rotation(world):
    return [world.anna, world.bartek, world.celina]


# --- correcting a draft -----------------------------------------------------


def _correction(schedule, day, role, who, *, version=None) -> DraftCorrection:
    return DraftCorrection(
        COORDINATOR, schedule.id, schedule.version if version is None else version, day, role, who
    )


async def test_a_correction_hands_the_slot_over_and_reports_the_rules_it_breaks(world) -> None:
    schedule = world.schedules.put(complete_schedule(MONDAY, _rotation(world)))

    warnings = await correct_draft(
        _correction(schedule, MONDAY, AssignmentRole.primary, world.dawid.id), world.drafts
    )

    corrected = world.schedules.by_id[schedule.id]
    held = next(item for item in corrected.assignments if item.slot == (MONDAY, "primary"))
    assert (held.assignee_name, held.member_id, held.is_override) == ("Dawid", world.dawid.id, True)
    assert corrected.version == schedule.version + 1
    assert warnings == []
    assert world.journal.events == [
        ("draft_corrected", {"args": (schedule.id, (MONDAY, "primary"), "Anna", "Dawid")})
    ]


@pytest.mark.parametrize(
    ("change", "error"),
    [
        ({"status": ScheduleStatus.proposed}, errors.EditableDraftNotFound),
        ({"version": 7}, errors.DraftChanged),
    ],
)
async def test_only_the_current_version_of_a_draft_can_be_corrected(world, change, error) -> None:
    schedule = complete_schedule(MONDAY, _rotation(world))
    if "status" in change:
        schedule = replace(schedule, status=change["status"])
    world.schedules.put(schedule)

    with pytest.raises(error):
        await correct_draft(
            _correction(
                schedule,
                MONDAY,
                AssignmentRole.primary,
                world.dawid.id,
                version=change.get("version"),
            ),
            world.drafts,
        )
    assert world.journal.events == []


async def test_a_correction_is_refused_for_what_the_slot_cannot_take(world) -> None:
    schedule = world.schedules.put(complete_schedule(MONDAY, _rotation(world)))
    unavailable = world.team.add(member("Ela", unavailable=[MONDAY]))
    no_late_shift = world.team.add(member("Filip", roles=[AssignmentRole.primary]))
    cases = [
        (
            MONDAY - timedelta(days=1),
            AssignmentRole.primary,
            world.dawid.id,
            errors.DateOutsideDraft,
        ),
        (SATURDAY, AssignmentRole.late_shift, world.dawid.id, errors.LateShiftOnlyOnWorkingDays),
        (MONDAY, AssignmentRole.primary, uuid.uuid4(), errors.ReplacementNotFound),
        (MONDAY, AssignmentRole.late_shift, no_late_shift.id, errors.ReplacementNotEligible),
        (MONDAY, AssignmentRole.primary, unavailable.id, errors.ReplacementUnavailable),
        # Bartek already holds secondary that Monday.
        (MONDAY, AssignmentRole.primary, world.bartek.id, errors.SecondOnCallSameDay),
    ]
    for day, role, who, error in cases:
        with pytest.raises(error):
            await correct_draft(_correction(schedule, day, role, who), world.drafts)
    assert world.schedules.by_id[schedule.id] == schedule


async def test_a_slot_the_draft_does_not_have_cannot_be_corrected(world) -> None:
    schedule = complete_schedule(MONDAY, _rotation(world))
    without_late_shift = tuple(
        item for item in schedule.assignments if item.slot != (MONDAY, AssignmentRole.late_shift)
    )
    schedule = world.schedules.put(replace(schedule, assignments=without_late_shift))

    with pytest.raises(errors.DraftSlotNotFound):
        await correct_draft(
            _correction(schedule, MONDAY, AssignmentRole.late_shift, world.dawid.id), world.drafts
        )


# --- lifecycle --------------------------------------------------------------


async def test_a_draft_with_hard_unavailability_cannot_be_proposed(world) -> None:
    blocked = world.team.add(member("Ela", unavailable=[MONDAY]))
    schedule = world.schedules.put(complete_schedule(MONDAY, [blocked, world.anna, world.bartek]))

    with pytest.raises(errors.ProposalHasUnavailablePeople) as refused:
        await propose(Transition(COORDINATOR, schedule.id, schedule.version), world.drafts)

    assert [item.message for item in refused.value.conflicts] == [
        "2030-03-04 · primary: Ela ma twardą niedostępność"
    ]
    assert world.schedules.by_id[schedule.id].status == ScheduleStatus.draft


async def test_propose_and_withdraw_move_the_version_or_refuse_a_stale_one(world) -> None:
    schedule = world.schedules.put(complete_schedule(MONDAY, _rotation(world)))

    with pytest.raises(errors.DraftStateChanged):
        await propose(Transition(COORDINATOR, schedule.id, schedule.version + 1), world.drafts)
    await propose(Transition(COORDINATOR, schedule.id, schedule.version), world.drafts)
    with pytest.raises(errors.ProposalStateChanged):
        await withdraw(Transition(COORDINATOR, schedule.id, schedule.version), world.drafts)
    await withdraw(Transition(COORDINATOR, schedule.id, schedule.version + 1), world.drafts)

    assert world.schedules.by_id[schedule.id].version == schedule.version + 2
    assert world.journal.names == ["schedule_proposed", "proposal_withdrawn"]


async def test_published_schedules_stay_but_imported_history_can_be_deleted(world) -> None:
    published = world.schedules.put(
        complete_schedule(MONDAY, _rotation(world), status=ScheduleStatus.published)
    )
    imported = world.schedules.put(
        complete_schedule(
            MONDAY,
            _rotation(world),
            status=ScheduleStatus.superseded,
            name="Import historii: plik.csv",
        )
    )

    with pytest.raises(errors.ScheduleNotDeletable):
        await delete_schedule(published.id, world.drafts)
    await delete_schedule(imported.id, world.drafts)

    assert world.schedules.deleted == [imported.id]
    assert world.journal.events == [
        ("schedule_deleted", {"args": (imported, "zaimportowaną historię")})
    ]


# --- policy and queue -------------------------------------------------------


async def test_a_policy_needs_one_weight_above_zero(world) -> None:
    with pytest.raises(errors.PolicyWithoutWeight):
        await change_policy(
            PolicyChange(
                RotationMode.daily, fairness_weight=0, preference_weight=0, continuity_weight=0
            ),
            world.policy_ports,
        )
    assert world.journal.events == []

    # Weights left out keep their value, so zeroing two of three is fine.
    policy = await change_policy(
        PolicyChange(RotationMode.daily, fairness_weight=0, preference_weight=0), world.policy_ports
    )
    assert (policy.rotation_mode, policy.continuity_weight) == (RotationMode.daily, 1.0)
    assert world.journal.names == ["policy_updated"]


async def test_a_range_already_in_flight_is_handed_back_instead_of_queued_twice(world) -> None:
    ends_on = MONDAY + timedelta(days=13)
    request = GenerationRequest(COORDINATOR, MONDAY, ends_on)

    first = await queue_generation(request, world.generation_requests, lanes=1, today=MONDAY)
    second = await queue_generation(request, world.generation_requests, lanes=1, today=MONDAY)

    assert second.view.run == first.view.run
    assert len(world.queue.enqueued) == 1
    assert first.uncovered_before == ()


async def test_the_start_estimate_counts_whole_lanes_of_runs_ahead(world) -> None:
    for _ in range(3):
        world.queue.put(
            queued_run(
                MONDAY, MONDAY + timedelta(days=1), status="completed", took=timedelta(seconds=40)
            )
        )
    for offset in range(4):
        world.queue.put(queued_run(MONDAY + timedelta(days=offset), MONDAY + timedelta(days=9)))

    queued = await queue_generation(
        GenerationRequest(COORDINATOR, MONDAY + timedelta(days=20), MONDAY + timedelta(days=30)),
        world.generation_requests,
        lanes=2,
        today=MONDAY,
    )

    # Four runs ahead over two lanes: two full runs of ~40 s before this one.
    assert (queued.view.queue_position, queued.view.estimated_start_seconds) == (4, 80)


async def test_without_finished_runs_the_estimate_falls_back_to_the_budget_ceiling(world) -> None:
    world.queue.put(queued_run(MONDAY, MONDAY + timedelta(days=9)))

    queued = await queue_generation(
        GenerationRequest(COORDINATOR, MONDAY + timedelta(days=20), MONDAY + timedelta(days=30)),
        world.generation_requests,
        lanes=1,
        today=MONDAY,
    )

    assert (queued.view.queue_position, queued.view.estimated_start_seconds) == (1, 60)


# --- generation -------------------------------------------------------------


async def test_a_failed_solve_stores_nothing_and_says_why(world) -> None:
    world.solver.result = SolverResult(
        assignments=(),
        conflicts=("PRIMARY: brak osoby",),
        status="INFEASIBLE",
        failure_reason="INFEASIBLE",
    )

    with pytest.raises(errors.GenerationFailed) as failed:
        await generate_draft(GenerationRequest(COORDINATOR, MONDAY, MONDAY), world.generation)

    assert (failed.value.message, failed.value.reason, failed.value.conflicts) == (
        "Reguły twarde nie pozwalają utworzyć kompletnego grafiku",
        "INFEASIBLE",
        ("PRIMARY: brak osoby",),
    )
    assert world.schedules.stored == [] and world.journal.events == []


async def test_a_solved_draft_is_named_after_its_mode_and_linked_to_its_people(world) -> None:
    world.solver.result = SolverResult(
        assignments=(
            GeneratedAssignment(MONDAY, AssignmentRole.primary, "Anna"),
            GeneratedAssignment(MONDAY, AssignmentRole.secondary, "Nieznany"),
        ),
        conflicts=(),
        status="OPTIMAL",
    )

    stored = await generate_draft(
        GenerationRequest(COORDINATOR, MONDAY, MONDAY + timedelta(days=6)), world.generation
    )

    ((kept, draft),) = world.schedules.stored
    assert kept is stored
    assert draft.name == "Szkic hybrydowy 04-03-2030 - 10-03-2030"
    assert [member_id for _item, member_id in draft.assignments] == [world.anna.id, None]
    (problem,) = world.solver.problems
    assert [item.name for item in problem.members] == ["Anna", "Bartek", "Celina", "Dawid"]
    assert world.journal.events == [("draft_generated", {"args": (stored, draft)})]


# --- comparing and staleness ------------------------------------------------


async def test_only_a_daily_and_a_weekly_variant_of_one_range_compare(world) -> None:
    daily = world.schedules.put(
        replace(complete_schedule(MONDAY, _rotation(world)), rotation_mode=RotationMode.daily)
    )
    weekly = world.schedules.put(
        replace(complete_schedule(MONDAY, _rotation(world)), rotation_mode=RotationMode.weekly)
    )
    later = world.schedules.put(
        replace(
            complete_schedule(MONDAY + timedelta(days=1), _rotation(world)),
            rotation_mode=RotationMode.weekly,
        )
    )

    with pytest.raises(errors.VariantNotFound):
        await compare_variants(daily.id, uuid.uuid4(), world.schedules)
    with pytest.raises(errors.VariantRangesDiffer):
        await compare_variants(daily.id, later.id, world.schedules)
    with pytest.raises(errors.VariantModesMismatch):
        await compare_variants(daily.id, daily.id, world.schedules)
    comparison = await compare_variants(daily.id, weekly.id, world.schedules)
    # A holder change every day on both on-call roles (13 + 13) and between
    # consecutive working days on 11-19 (4 + 4).
    assert [item.handovers for item in comparison.variants] == [34, 34]


async def test_only_changes_touching_the_draft_window_make_it_stale(world) -> None:
    schedule = complete_schedule(MONDAY, _rotation(world))
    near, far = uuid.uuid4(), uuid.uuid4()
    world.changes.availability = {near: (MONDAY, MONDAY), far: (date(2040, 1, 1), date(2040, 1, 2))}
    world.changes.add("availability.created", entity_id=near)
    world.changes.add("availability.created", entity_id=far)
    world.changes.add("policy.updated")
    world.changes.add("schedule.override", details={"service_date": "2040-01-01"})
    world.changes.add("admin.team_member_updated", entity_id=world.dawid.id)
    world.changes.add("admin.team_member_updated", entity_id=world.anna.id)
    world.changes.add("policy.updated", at=datetime(2029, 1, 1, tzinfo=UTC))

    # The nearby entry, the policy change and Anna, who is in the draft.
    assert await stale_changes_count(schedule, world.changes) == 3


async def test_the_original_holder_is_read_from_moves_or_from_an_old_summary(world) -> None:
    schedule_id = uuid.uuid4()
    world.changes.add(
        "schedule.override",
        entity_id=schedule_id,
        summary="Override 2030-03-05 · primary: Igor → Tomasz",
        details={"service_date": "2030-03-05", "role": "primary"},
    )
    world.changes.add(
        "schedule.override_batch",
        entity_id=schedule_id,
        details={
            "moves": [
                {
                    "service_date": "2030-03-06",
                    "role": "secondary",
                    "previous_assignee_name": "Halina",
                }
            ]
        },
    )

    assert await override_original_assignees(world.changes, {schedule_id}) == {
        (schedule_id, date(2030, 3, 5), AssignmentRole.primary): "Igor",
        (schedule_id, date(2030, 3, 6), AssignmentRole.secondary): "Halina",
    }


# --- publication ------------------------------------------------------------


def _override_in_force(world, day, role, holder, original):
    slot = (day, role)
    world.roster.schedule_ref.slots[slot] = Duty(
        day, role, holder.id, holder.display_name, True, world.roster.schedule_ref.id
    )
    world.changes.add(
        "schedule.override",
        entity_id=world.roster.schedule_ref.id,
        details={
            "moves": [
                {
                    "service_date": day.isoformat(),
                    "role": role.value,
                    "previous_assignee_name": original,
                }
            ]
        },
    )


def _request(schedule, **flags) -> PublicationRequest:
    return PublicationRequest(COORDINATOR, schedule.id, schedule.version, **flags)


async def test_publication_carries_a_safe_change_and_replaces_the_rest(world) -> None:
    published = complete_schedule(MONDAY, _rotation(world), status=ScheduleStatus.published)
    world.publish_roster_from(published)
    _override_in_force(world, MONDAY, AssignmentRole.primary, world.dawid, "Anna")
    proposal = world.schedules.put(
        complete_schedule(
            MONDAY, _rotation(world), status=ScheduleStatus.proposed, name="Szkic marzec"
        )
    )
    pending = PendingSwap(
        uuid.uuid4(),
        world.roster.schedule_ref.id,
        MONDAY + timedelta(days=2),
        AssignmentRole.primary,
        "pending_coordinator",
        world.celina.id,
        world.dawid.id,
        (MONDAY + timedelta(days=2),),
    )
    world.swaps.pending.append(pending)

    with pytest.raises(errors.RestViolationsNotAcknowledged):
        await publish(_request(proposal), world.publication, today=MONDAY, now=NOW)
    assert world.schedules.carried == []

    await publish(
        _request(proposal, acknowledge_rest_violations=True),
        world.publication,
        today=MONDAY,
        now=NOW,
    )

    (carried,) = world.schedules.carried
    assert (carried.slot, carried.assignee_name, carried.member_id) == (
        (MONDAY, AssignmentRole.primary),
        "Dawid",
        world.dawid.id,
    )
    assert world.swaps.cancelled == [pending.id]
    assert world.schedules.retired_by == [proposal.id]
    assert world.schedules.published == [(proposal.id, "Grafik marzec", NOW)]
    assert world.journal.names == [
        "change_carried",
        "swap_cancelled_by_publication",
        "assignments_changed_by_publication",
        "schedule_published",
    ]
    # The carried slot keeps its holder, so nobody is told it changed.
    changed = dict(world.journal.events)["assignments_changed_by_publication"]["args"][1]
    assert changed == []
    # The team is told about the slots as published, the carried one included.
    announced = dict(world.journal.events)["schedule_published"]["args"][0]
    (monday_primary,) = (
        item for item in announced.assignments if item.slot == (MONDAY, AssignmentRole.primary)
    )
    assert (
        monday_primary.assignee_name,
        monday_primary.member_id,
        monday_primary.is_override,
    ) == ("Dawid", world.dawid.id, True)


async def test_publication_asks_for_every_decision_in_turn(world) -> None:
    published = complete_schedule(MONDAY, _rotation(world), status=ScheduleStatus.published)
    world.publish_roster_from(published)
    # Tuesday: the new draft puts Celina on primary and Anna on secondary.
    tuesday = MONDAY + timedelta(days=1)
    _override_in_force(world, MONDAY, AssignmentRole.primary, world.dawid, "Anna")
    _override_in_force(world, tuesday, AssignmentRole.primary, world.anna, "Bartek")
    proposal = world.schedules.put(
        complete_schedule(
            MONDAY,
            [world.bartek, world.celina, world.anna],
            status=ScheduleStatus.proposed,
        )
    )
    keys = [f"{MONDAY}:primary", f"{tuesday}:primary"]
    today = MONDAY - timedelta(days=3)

    async def attempt(**flags):
        await publish(_request(proposal, **flags), world.publication, today=today, now=NOW)

    with pytest.raises(errors.LostChangesNotAcknowledged) as lost:
        await attempt()
    assert [item.key for item in lost.value.lost_changes] == keys
    with pytest.raises(errors.ChangeResolutionRequired) as required:
        await attempt(acknowledge_lost_changes=True, change_resolutions={keys[0]: "draft"})
    assert required.value.slots == [keys[1]]
    with pytest.raises(errors.GapNotAcknowledged):
        await attempt(
            acknowledge_lost_changes=True, change_resolutions=dict.fromkeys(keys, "draft")
        )
    with pytest.raises(errors.ChangeResolutionInvalid) as invalid:
        await attempt(
            acknowledge_lost_changes=True,
            acknowledge_gap=True,
            change_resolutions=dict.fromkeys(keys, "change"),
        )
    # Anna would hold Tuesday's primary and secondary at once.
    assert invalid.value.conflicts == {
        (tuesday, AssignmentRole.primary): "Ta osoba miałaby już drugi dyżur on-call tego dnia"
    }
    assert world.schedules.carried == [] and world.journal.events == []

    await attempt(
        acknowledge_lost_changes=True,
        acknowledge_gap=True,
        acknowledge_rest_violations=True,
        change_resolutions={keys[0]: "change", keys[1]: "draft"},
    )
    assert [item.slot for item in world.schedules.carried] == [(MONDAY, AssignmentRole.primary)]


async def test_only_a_complete_current_proposal_is_published(world) -> None:
    proposal = world.schedules.put(
        complete_schedule(MONDAY, _rotation(world), status=ScheduleStatus.proposed)
    )
    with pytest.raises(errors.PublicationStateChanged):
        await publish(
            replace(_request(proposal), expected_version=9),
            world.publication,
            today=MONDAY,
            now=NOW,
        )

    gap = world.schedules.put(
        replace(proposal, id=uuid.uuid4(), assignments=proposal.assignments[1:])
    )
    with pytest.raises(errors.IncompleteSchedule):
        await publish(_request(gap), world.publication, today=MONDAY, now=NOW)

    blocked = world.team.add(member("Ela", unavailable=[MONDAY]))
    unavailable = world.schedules.put(
        complete_schedule(
            MONDAY, [blocked, world.anna, world.bartek], status=ScheduleStatus.proposed
        )
    )
    with pytest.raises(errors.PublicationHasUnavailablePeople):
        await publish(_request(unavailable), world.publication, today=MONDAY, now=NOW)
    assert world.schedules.published == [] and world.journal.events == []


async def test_soft_preferences_never_block_a_publication(world) -> None:
    reluctant = world.team.add(
        member(
            "Ela",
            availability=[AvailabilityPeriod(AvailabilityKind.prefer_not, MONDAY, MONDAY)],
        )
    )
    proposal = world.schedules.put(
        complete_schedule(
            MONDAY, [reluctant, world.anna, world.bartek], status=ScheduleStatus.proposed
        )
    )

    await publish(
        _request(proposal, acknowledge_rest_violations=True),
        world.publication,
        today=MONDAY,
        now=NOW,
    )
    assert len(world.schedules.published) == 1


async def test_a_kept_change_checks_eligibility_periods_not_membership_dates(world) -> None:
    """Republication has always asked only whether an eligibility period for
    the role covers the day; a member whose membership has ended but whose
    period is still open keeps a change resolved as "change"."""
    departed = world.team.add(replace(member("Gosia"), active_until=MONDAY - timedelta(days=30)))
    world.publish_roster_from(
        complete_schedule(MONDAY, _rotation(world), status=ScheduleStatus.published)
    )
    _override_in_force(world, MONDAY, AssignmentRole.primary, departed, "Anna")
    proposal = world.schedules.put(
        complete_schedule(
            MONDAY, [world.bartek, world.celina, world.anna], status=ScheduleStatus.proposed
        )
    )

    await publish(
        _request(
            proposal,
            acknowledge_lost_changes=True,
            acknowledge_rest_violations=True,
            change_resolutions={f"{MONDAY}:primary": "change"},
        ),
        world.publication,
        today=MONDAY,
        now=NOW,
    )

    (carried,) = world.schedules.carried
    assert (carried.slot, carried.assignee_name) == ((MONDAY, AssignmentRole.primary), "Gosia")


async def test_a_pending_swap_outside_the_published_range_is_not_a_publication_notice(
    world,
) -> None:
    """The warning is about swaps this publication would cancel.

    A publication cancels the pending swaps it takes the slots of. A month is
    published, a fortnight inside it is about to replace part of it, and a swap
    is pending on a day in the half the fortnight does not touch: that swap
    survives, so warning about it would ask the coordinator to worry about
    something that is not going to happen.
    """
    month = complete_schedule(MONDAY, _rotation(world), days=28, status=ScheduleStatus.published)
    world.publish_roster_from(month)
    fortnight = world.schedules.put(
        complete_schedule(
            MONDAY, _rotation(world), status=ScheduleStatus.proposed, name="Szkic marzec"
        )
    )
    untouched_day = MONDAY + timedelta(days=20)
    world.swaps.pending.append(
        PendingSwap(
            uuid.uuid4(),
            world.roster.schedule_ref.id,
            untouched_day,
            AssignmentRole.primary,
            "pending_coordinator",
            world.celina.id,
            world.dawid.id,
            (untouched_day,),
        )
    )

    preview = await preview_publication(fortnight.id, world.publication, today=MONDAY)

    assert preview.pending_swaps == ()


async def test_a_carry_is_not_refused_for_a_rule_the_rotation_does_not_have(world) -> None:
    """The carry check asks the hard rules whether a protected change can be
    kept. Under weekly rotation the rest rules are not among them, so a change
    that would be lost in a hybrid roster is carried here instead."""
    published = complete_schedule(MONDAY, _rotation(world), status=ScheduleStatus.published)
    world.publish_roster_from(published)
    for offset in (1, 2, 3):
        day = MONDAY - timedelta(days=offset)
        world.roster.schedule_ref.slots[(day, AssignmentRole.primary)] = Duty(
            day,
            AssignmentRole.primary,
            world.dawid.id,
            world.dawid.display_name,
            False,
            world.roster.schedule_ref.id,
        )
    _override_in_force(world, MONDAY, AssignmentRole.primary, world.dawid, "Anna")
    proposal = world.schedules.put(
        complete_schedule(
            MONDAY, _rotation(world), status=ScheduleStatus.proposed, name="Szkic marzec"
        )
    )

    hybrid = await preview_publication(proposal.id, world.publication, today=MONDAY)
    world.policy.policy = replace(world.policy.policy, rotation_mode=RotationMode.weekly)
    weekly = await preview_publication(proposal.id, world.publication, today=MONDAY)

    assert [item.reason for item in hybrid.lost_changes] == ["Przeniesienie narusza reguły grafiku"]
    assert weekly.lost_changes == ()
    assert [item.previous_assignee_name for item in weekly.carried_changes] == ["Dawid"]
