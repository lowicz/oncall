"""Reading, correcting and changing the lifecycle of schedule drafts."""

import uuid
from datetime import timedelta

from oncall.domain.ports import TeamDirectory
from oncall.domain.scheduling import errors
from oncall.domain.scheduling.models import (
    Comparison,
    DraftCorrection,
    FairnessImpact,
    LensImpact,
    Plan,
    PlanSummary,
    Transition,
    UnavailabilityConflict,
)
from oncall.domain.scheduling.planning import comparison_metrics, member_rest_warnings
from oncall.domain.scheduling.ports import SchedulingPorts
from oncall.domain.vocabulary import AssignmentRole, LateShiftAnchor, RotationMode, ScheduleStatus
from oncall.fairness import (
    ACCEPTANCE_POINTS,
    FairnessDuty,
    compute_fairness,
    criterion_member_ids,
    graded_lenses,
    lens_spread,
    project_duties,
)
from oncall.workdays import is_working_day, polish_holidays


async def unavailability_conflicts(
    plan: Plan, team: TeamDirectory
) -> tuple[UnavailabilityConflict, ...]:
    member_ids = {item.member_id for item in plan.assignments if item.member_id is not None}
    if not member_ids:
        return ()
    members = await team.members(member_ids)
    conflicts = [
        UnavailabilityConflict(item.service_date, item.role, item.assignee_name)
        for item in plan.assignments
        if item.member_id is not None
        and (member := members.get(item.member_id)) is not None
        and member.is_unavailable(item.service_date)
    ]
    conflicts.sort(key=lambda item: (item.service_date, item.role.value))
    return tuple(conflicts)


async def open_drafts(limit: int, ports: SchedulingPorts) -> list[PlanSummary]:
    return await ports.plans.open_drafts(limit)


async def compare_variants(
    left_id: uuid.UUID, right_id: uuid.UUID, ports: SchedulingPorts
) -> Comparison:
    by_id = await ports.plans.plans((left_id, right_id))
    if left_id not in by_id or right_id not in by_id:
        raise errors.VariantNotFound()
    left, right = by_id[left_id], by_id[right_id]
    if (left.starts_on, left.ends_on) != (right.starts_on, right.ends_on):
        raise errors.VariantRangesDiffer()
    if {left.rotation_mode, right.rotation_mode} != {RotationMode.daily, RotationMode.weekly}:
        raise errors.VariantModesMismatch()
    return Comparison(
        left.starts_on, left.ends_on, (comparison_metrics(left), comparison_metrics(right))
    )


async def fairness_impact(schedule_id: uuid.UUID, ports: SchedulingPorts) -> FairnessImpact:
    plan = await ports.plans.plan(schedule_id)
    if plan is None:
        raise errors.ScheduleNotFound(schedule_id)
    # Both sides use one rolling window. The draft replaces regenerated slots
    # instead of adding a second duty on top of the published assignment.
    projected_end = plan.ends_on
    projected_start = projected_end - timedelta(days=365)
    members = await ports.members.active_between(projected_start, projected_end)
    historical = await ports.history.duties_in_force(projected_start, projected_end)
    draft_duties = [
        FairnessDuty(
            service_date=item.service_date,
            role=item.role,
            assignee_name=item.assignee_name,
            member_id=item.member_id,
        )
        for item in plan.assignments
    ]
    holidays = polish_holidays(projected_start, projected_end)
    baseline = compute_fairness(
        members,
        historical,
        holidays=holidays,
        window_start=projected_start,
        window_end=projected_end,
    )
    projected = compute_fairness(
        members,
        project_duties(historical, draft_duties),
        holidays=holidays,
        window_start=projected_start,
        window_end=projected_end,
    )
    policy = await ports.policy.current()
    late_shift_balanced = policy.late_shift_anchor == LateShiftAnchor.independent
    criterion_ids = criterion_member_ids(members, projected_end)
    spreads = tuple(
        LensImpact(
            lens=lens,
            before=lens_spread(baseline.members, lens, criterion_ids),
            after=lens_spread(projected.members, lens, criterion_ids),
            meets_criterion=lens_spread(projected.members, lens, criterion_ids)
            <= ACCEPTANCE_POINTS,
        )
        for lens in graded_lenses(late_shift_balanced)
    )
    return FairnessImpact(
        plan=plan,
        as_of=projected_end,
        baseline=tuple(baseline.members),
        projected=tuple(projected.members),
        criterion_ids=frozenset(criterion_ids),
        late_shift_balanced=late_shift_balanced,
        criterion_points=ACCEPTANCE_POINTS,
        spreads=spreads,
    )


async def correct_draft(correction: DraftCorrection, ports: SchedulingPorts) -> list[str]:
    """Give one draft slot to another eligible and available member."""
    plan = await ports.plans.plan_to_correct(correction.schedule_id)
    if plan is None or plan.status != ScheduleStatus.draft:
        raise errors.EditableDraftNotFound(correction.schedule_id)
    if plan.version != correction.expected_version:
        raise errors.DraftChanged(plan.id)
    day, role = correction.service_date, correction.role
    if not plan.starts_on <= day <= plan.ends_on:
        raise errors.DateOutsideDraft(day)
    if role == AssignmentRole.late_shift and not is_working_day(day, polish_holidays(day, day)):
        raise errors.LateShiftOnlyOnWorkingDays(day)
    replacement = await ports.team.member(correction.replacement_member_id)
    if replacement is None:
        raise errors.ReplacementNotFound(correction.replacement_member_id)
    if not replacement.is_eligible(role, day):
        raise errors.ReplacementNotEligible(replacement.id, (day, role))
    if replacement.is_unavailable(day):
        raise errors.ReplacementUnavailable(replacement.id, day)
    assignment = next((item for item in plan.assignments if item.slot == (day, role)), None)
    if assignment is None:
        raise errors.DraftSlotNotFound((day, role))
    if role in (AssignmentRole.primary, AssignmentRole.secondary):
        opposite = (
            AssignmentRole.secondary if role == AssignmentRole.primary else AssignmentRole.primary
        )
        if any(
            item.slot == (day, opposite) and item.member_id == replacement.id
            for item in plan.assignments
        ):
            raise errors.SecondOnCallSameDay(replacement.id, day)
    corrected = plan.with_holder((day, role), replacement.display_name, replacement.id)
    warnings = member_rest_warnings(corrected, replacement.id)
    await ports.plans.correct(plan.id, (day, role), replacement)
    await ports.journal.draft_corrected(
        plan.id, (day, role), assignment.assignee_name, replacement.display_name
    )
    return warnings


async def delete_plan(schedule_id: uuid.UUID, ports: SchedulingPorts) -> None:
    plan = await ports.plans.plan(schedule_id)
    if plan is None:
        raise errors.ScheduleNotFound(schedule_id)
    imported_history = plan.is_imported_history
    if plan.status not in (ScheduleStatus.draft, ScheduleStatus.proposed) and not imported_history:
        raise errors.ScheduleNotDeletable(plan.id)
    kind = (
        "zaimportowaną historię"
        if imported_history
        else "propozycję"
        if plan.status == ScheduleStatus.proposed
        else "szkic"
    )
    await ports.journal.schedule_deleted(plan, kind)
    await ports.plans.delete(plan.id)


async def propose(transition: Transition, ports: SchedulingPorts) -> None:
    plan = await ports.plans.plan(transition.schedule_id)
    if plan is None:
        raise errors.ScheduleNotFound(transition.schedule_id)
    conflicts = await unavailability_conflicts(plan, ports.team)
    if conflicts:
        raise errors.ProposalHasUnavailablePeople(conflicts)
    if not await ports.plans.change_status(
        plan.id,
        from_status=ScheduleStatus.draft,
        to_status=ScheduleStatus.proposed,
        expected_version=transition.expected_version,
    ):
        raise errors.DraftStateChanged(plan.id)
    await ports.journal.schedule_proposed(plan.id)


async def withdraw(transition: Transition, ports: SchedulingPorts) -> None:
    if not await ports.plans.change_status(
        transition.schedule_id,
        from_status=ScheduleStatus.proposed,
        to_status=ScheduleStatus.draft,
        expected_version=transition.expected_version,
    ):
        raise errors.ProposalStateChanged(transition.schedule_id)
    await ports.journal.proposal_withdrawn(transition.schedule_id)
