from datetime import date

import pytest

from oncall.domain.scheduling.errors import IncompleteSchedule, SamePersonOnBothOnCallRoles
from oncall.domain.scheduling.planning import validate_complete
from oncall.models import Assignment, AssignmentRole, Schedule, ScheduleStatus


def schedule_with(assignments: list[Assignment]) -> Schedule:
    return Schedule(
        name="Test",
        starts_on=date(2026, 9, 20),
        ends_on=date(2026, 9, 20),
        status=ScheduleStatus.proposed,
        assignments=assignments,
    )


def test_complete_schedule_is_publishable() -> None:
    schedule = schedule_with(
        [
            Assignment(
                service_date=date(2026, 9, 20),
                role=AssignmentRole.primary,
                assignee_name="Anna",
            ),
            Assignment(
                service_date=date(2026, 9, 20),
                role=AssignmentRole.secondary,
                assignee_name="Marek",
            ),
        ]
    )
    validate_complete(schedule)


def test_incomplete_schedule_is_not_publishable() -> None:
    schedule = schedule_with(
        [
            Assignment(
                service_date=date(2026, 9, 20),
                role=AssignmentRole.primary,
                assignee_name="Anna",
            )
        ]
    )
    with pytest.raises(IncompleteSchedule, match="pełnego pokrycia"):
        validate_complete(schedule)


def test_same_primary_and_secondary_is_not_publishable() -> None:
    schedule = schedule_with(
        [
            Assignment(
                service_date=date(2026, 9, 20),
                role=AssignmentRole.primary,
                assignee_name="Anna",
            ),
            Assignment(
                service_date=date(2026, 9, 20),
                role=AssignmentRole.secondary,
                assignee_name="Anna",
            ),
        ]
    )
    with pytest.raises(SamePersonOnBothOnCallRoles, match="primary i secondary"):
        validate_complete(schedule)


def test_late_shift_on_day_off_is_not_publishable() -> None:
    schedule = schedule_with(
        [
            Assignment(
                service_date=date(2026, 9, 20),
                role=AssignmentRole.primary,
                assignee_name="Anna",
            ),
            Assignment(
                service_date=date(2026, 9, 20),
                role=AssignmentRole.secondary,
                assignee_name="Marek",
            ),
            Assignment(
                service_date=date(2026, 9, 20),
                role=AssignmentRole.late_shift,
                assignee_name="Marek",
            ),
        ]
    )
    with pytest.raises(IncompleteSchedule, match="pełnego pokrycia"):
        validate_complete(schedule)
