"""Planning rules a schedule is judged by before anyone sees it."""

import uuid
from dataclasses import replace
from datetime import date, timedelta

import pytest

from oncall.domain.scheduling import errors
from oncall.domain.scheduling.models import CoveredSpan, ScheduledDuty
from oncall.domain.scheduling.planning import (
    first_uncovered,
    member_rest_warnings,
    rule_warnings,
    validate_complete,
)
from oncall.domain.vocabulary import AssignmentRole
from tests.domain.fakes import member
from tests.domain.scheduling_fakes import complete_schedule

MONDAY = date(2030, 3, 4)
SUNDAY = date(2030, 3, 10)


def test_a_span_starting_later_leaves_today_uncovered() -> None:
    later = CoveredSpan(MONDAY + timedelta(days=3), MONDAY + timedelta(days=9))
    earlier = CoveredSpan(MONDAY - timedelta(days=9), MONDAY - timedelta(days=3))

    assert first_uncovered(MONDAY, [later, earlier]) == MONDAY


def test_somebody_with_only_late_shifts_has_no_rest_warning() -> None:
    rotation = [member("Anna"), member("Bartek"), member("Celina")]
    schedule = complete_schedule(MONDAY, rotation, days=7)
    only_late = uuid.uuid4()
    assignments = tuple(
        replace(item, member_id=only_late, assignee_name="Dawid")
        if item.role == AssignmentRole.late_shift
        else item
        for item in schedule.assignments
    )

    assert member_rest_warnings(replace(schedule, assignments=assignments), only_late) == []


def test_two_people_under_one_name_share_a_single_warning() -> None:
    """Warnings are sentences keyed by name; two members named alike who break
    the same rule on the same days read as one sentence, not twice."""
    first, second = uuid.uuid4(), uuid.uuid4()
    days = [MONDAY + timedelta(days=offset) for offset in range(4)]
    assignments = tuple(
        ScheduledDuty(day, role, "Anna", holder, False)
        for day in days
        for role, holder in ((AssignmentRole.primary, first), (AssignmentRole.secondary, second))
    )
    schedule = replace(
        complete_schedule(MONDAY, [member("Zenon")], days=4), assignments=assignments
    )

    warnings = rule_warnings(schedule)

    assert len(warnings) == len(set(warnings)) == 2
    assert all(item.startswith("Anna: ") for item in warnings)


def test_the_right_count_of_slots_in_the_wrong_roles_is_incomplete() -> None:
    """A Sunday with an 11-19 shift and a Monday without one add up to the
    expected number of slots, yet neither day has the roles it needs."""
    anna, bartek = uuid.uuid4(), uuid.uuid4()
    assignments = (
        ScheduledDuty(SUNDAY, AssignmentRole.primary, "Anna", anna, False),
        ScheduledDuty(SUNDAY, AssignmentRole.secondary, "Bartek", bartek, False),
        ScheduledDuty(SUNDAY, AssignmentRole.late_shift, "Bartek", bartek, False),
        ScheduledDuty(SUNDAY + timedelta(days=1), AssignmentRole.primary, "Anna", anna, False),
        ScheduledDuty(
            SUNDAY + timedelta(days=1), AssignmentRole.secondary, "Bartek", bartek, False
        ),
    )
    schedule = replace(
        complete_schedule(SUNDAY, [member("Zenon")], days=2), assignments=assignments
    )

    with pytest.raises(errors.IncompleteSchedule):
        validate_complete(schedule)
