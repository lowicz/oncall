"""What the scheduling screens read: schedules, their drafts and their impact."""

import uuid
from datetime import date, timedelta

from oncall.domain.scheduling import drafts, errors
from oncall.domain.scheduling.generation import uncovered_dates
from oncall.domain.scheduling.models import (
    Comparison,
    FairnessImpact,
    LensImpact,
    Schedule,
    ScheduleSummary,
    ScheduleView,
    SuggestedRange,
)
from oncall.domain.scheduling.planning import comparison_metrics, rule_warnings
from oncall.domain.scheduling.planning import suggested_range as calculate_suggested_range
from oncall.domain.scheduling.ports import ScheduleQueryPorts, ScheduleReads
from oncall.domain.scheduling.publication import stale_changes_count
from oncall.domain.vocabulary import LateShiftAnchor, RotationMode
from oncall.fairness import (
    ACCEPTANCE_POINTS,
    FairnessDuty,
    compute_fairness,
    criterion_member_ids,
    graded_lenses,
    lens_spread,
    project_duties,
)
from oncall.workdays import polish_holidays


async def view_schedule(
    schedule: Schedule,
    ports: ScheduleQueryPorts,
    *,
    today: date,
    warnings: list[str] | None = None,
) -> ScheduleView:
    """The schedule with everything the generator screen shows next to it.

    `warnings` replaces the rule warnings computed from the schedule, for a
    correction that reports the rules its replacement breaks.
    """
    return ScheduleView(
        schedule=schedule,
        rule_warnings=tuple(rule_warnings(schedule) if warnings is None else warnings),
        unavailability_conflicts=await drafts.unavailability_conflicts(schedule, ports.team),
        uncovered_before=tuple(await uncovered_dates(schedule.starts_on, ports.roster, today)),
        stale_changes_count=await stale_changes_count(schedule, ports.changes),
    )


async def show_schedule(
    schedule_id: uuid.UUID, ports: ScheduleQueryPorts, *, today: date
) -> ScheduleView:
    schedule = await ports.schedules.schedule(schedule_id)
    if schedule is None:
        raise errors.ScheduleNotFound(schedule_id)
    return await view_schedule(schedule, ports, today=today)


async def open_drafts(limit: int, schedules: ScheduleReads) -> list[ScheduleSummary]:
    return await schedules.open_drafts(limit)


async def compare_variants(
    left_id: uuid.UUID, right_id: uuid.UUID, schedules: ScheduleReads
) -> Comparison:
    by_id = await schedules.schedules((left_id, right_id))
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


async def suggest_range(schedules: ScheduleReads, *, today: date) -> SuggestedRange:
    spans = await schedules.covering_spans(today - timedelta(days=7))
    return calculate_suggested_range(today, spans)


async def fairness_impact(schedule_id: uuid.UUID, ports: ScheduleQueryPorts) -> FairnessImpact:
    schedule = await ports.schedules.schedule(schedule_id)
    if schedule is None:
        raise errors.ScheduleNotFound(schedule_id)
    # Both sides use one rolling window. The draft replaces regenerated slots
    # instead of adding a second duty on top of the published assignment.
    projected_end = schedule.ends_on
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
        for item in schedule.assignments
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
        schedule=schedule,
        as_of=projected_end,
        baseline=tuple(baseline.members),
        projected=tuple(projected.members),
        criterion_ids=frozenset(criterion_ids),
        late_shift_balanced=late_shift_balanced,
        criterion_points=ACCEPTANCE_POINTS,
        spreads=spreads,
    )
