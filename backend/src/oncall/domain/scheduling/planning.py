"""Pure rules about a schedule on its own: its range, its completeness, the
warnings it carries and how it compares to a variant.

They read only `starts_on`, `ends_on` and the assignments' `service_date`,
`role`, `member_id`, `assignee_name` and `is_override`, so they apply to a
`Plan` as well as to anything shaped like one.
"""

import uuid
from collections import defaultdict
from datetime import date, timedelta

from oncall.domain.scheduling.errors import IncompleteSchedule, SamePersonOnBothOnCallRoles
from oncall.domain.scheduling.models import CoveredSpan, Schedule, SuggestedRange, VariantMetrics
from oncall.domain.vocabulary import AssignmentRole
from oncall.rules import ONCALL_ROLES, exempt_days, oncall_rest_violations, summarise
from oncall.workdays import is_working_day, polish_holidays


def range_end(starts_on: date) -> date:
    """Sunday ending four full Monday-Sunday weeks after the starting week."""
    days_to_next_monday = 0 if starts_on.weekday() == 0 else 7 - starts_on.weekday()
    return starts_on + timedelta(days=days_to_next_monday + 27)


def first_uncovered(today: date, spans: list[CoveredSpan]) -> date:
    """First day not covered by the union of effective schedule ranges."""
    candidate = today
    for span in sorted(spans, key=lambda item: (item.starts_on, item.ends_on)):
        if span.ends_on < candidate:
            continue
        if span.starts_on > candidate:
            break
        candidate = max(candidate, span.ends_on + timedelta(days=1))
    return candidate


def is_covered(day: date, spans: list[CoveredSpan]) -> bool:
    return any(item.starts_on <= day <= item.ends_on for item in spans)


def suggested_start(today: date, spans: list[CoveredSpan]) -> date:
    """First safe uncovered day, without splitting a day-off block."""
    earliest_start = today + timedelta(days=1) if is_covered(today, spans) else today
    candidate = first_uncovered(earliest_start, spans)
    holidays = polish_holidays(candidate - timedelta(days=7), candidate + timedelta(days=7))
    if is_working_day(candidate, holidays):
        return candidate
    block_start = candidate
    while not is_working_day(block_start - timedelta(days=1), holidays):
        block_start -= timedelta(days=1)
    block_end = candidate
    while not is_working_day(block_end + timedelta(days=1), holidays):
        block_end += timedelta(days=1)
    block_days = [
        block_start + timedelta(days=offset) for offset in range((block_end - block_start).days + 1)
    ]
    if any(is_covered(day, spans) for day in block_days):
        return block_end + timedelta(days=1)
    return max(today, block_start)


def suggested_range(today: date, spans: list[CoveredSpan]) -> SuggestedRange:
    # An uncovered today belongs in the new range. If today is covered, begin
    # looking tomorrow so generation never proposes replacing a duty already
    # in progress. A weekend/holiday block stays indivisible: an untouched
    # block starts at its first day, a partly covered one starts after the block.
    start = suggested_start(today, spans)
    # Four full Monday-Sunday weeks from the starting week: 28 days when the
    # start is a Monday, up to 33 otherwise. No upper cap is needed:
    # `range_end` maxes out at start+33 on its own.
    return SuggestedRange(first_uncovered=start, starts_on=start, ends_on=range_end(start))


def member_rest_warnings(schedule: Schedule, member_id: uuid.UUID) -> list[str]:
    """Thin wrapper over `rules.oncall_rest_violations`, so the draft warnings
    and the post-publication blocks can never drift apart."""
    name = next(
        (item.assignee_name for item in schedule.assignments if item.member_id == member_id),
        str(member_id),
    )
    oncall_days = {
        item.service_date
        for item in schedule.assignments
        if item.member_id == member_id and item.role in ONCALL_ROLES
    }
    if not oncall_days:
        return []
    holidays = polish_holidays(schedule.starts_on, schedule.ends_on)
    days = sorted({item.service_date for item in schedule.assignments})
    return summarise(oncall_rest_violations(name, oncall_days, exempt_days(days, holidays)))


def rule_warnings(schedule: Schedule) -> list[str]:
    """Hard rules the schedule breaks as it stands, one sentence per person
    and rule, people taken in the order a set of their ids yields them."""
    warnings: list[str] = []
    for member_id in {item.member_id for item in schedule.assignments if item.member_id}:
        for warning in member_rest_warnings(schedule, member_id):
            if warning not in warnings:
                warnings.append(warning)
    return warnings


def validate_complete(schedule: Schedule) -> None:
    days = (schedule.ends_on - schedule.starts_on).days + 1
    polish_days = polish_holidays(schedule.starts_on, schedule.ends_on)
    by_day: dict[date, dict[AssignmentRole, uuid.UUID | str]] = defaultdict(dict)
    for assignment in schedule.assignments:
        by_day[assignment.service_date][assignment.role] = (
            assignment.member_id or assignment.assignee_name
        )
    expected_count = days * 2 + sum(
        is_working_day(schedule.starts_on + timedelta(days=offset), polish_days)
        for offset in range(days)
    )
    if len(schedule.assignments) != expected_count or len(by_day) != days:
        raise IncompleteSchedule()
    for day, assignments in by_day.items():
        expected_roles = {AssignmentRole.primary, AssignmentRole.secondary}
        if is_working_day(day, polish_days):
            expected_roles.add(AssignmentRole.late_shift)
        if set(assignments) != expected_roles:
            raise IncompleteSchedule()
        if assignments[AssignmentRole.primary] == assignments[AssignmentRole.secondary]:
            raise SamePersonOnBothOnCallRoles(day)


def comparison_metrics(schedule: Schedule) -> VariantMetrics:
    assignments = sorted(
        schedule.assignments, key=lambda item: (item.role.value, item.service_date)
    )
    handovers = 0
    max_streak = 0
    counts: dict[tuple[AssignmentRole, uuid.UUID | str], int] = defaultdict(int)
    previous: dict[AssignmentRole, tuple[uuid.UUID | str, date, int]] = {}
    for item in assignments:
        identity = item.member_id or item.assignee_name
        counts[(item.role, identity)] += 1
        prior = previous.get(item.role)
        streak = 1
        if prior is not None and prior[1] + timedelta(days=1) == item.service_date:
            if prior[0] == identity:
                streak = prior[2] + 1
            else:
                handovers += 1
        previous[item.role] = (identity, item.service_date, streak)
        max_streak = max(max_streak, streak)
    role_spreads = []
    for role in AssignmentRole:
        values = [count for (count_role, _), count in counts.items() if count_role == role]
        if values:
            role_spreads.append(max(values) - min(values))
    return VariantMetrics(
        id=schedule.id,
        name=schedule.name,
        rotation_mode=schedule.rotation_mode,
        assignment_count=len(assignments),
        handovers=handovers,
        max_consecutive_days=max_streak,
        load_spread=max(role_spreads, default=0),
        override_count=sum(item.is_override for item in assignments),
    )
