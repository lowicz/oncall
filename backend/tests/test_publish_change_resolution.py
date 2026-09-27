"""B3 review (QA7 par. 8): a republish's "change" resolution used to write
the previous assignee straight back with no rule check at all."""

from datetime import date

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.scheduling.models import ProtectedChange
from oncall.domain.scheduling.publication import change_resolution_conflicts
from oncall.domain.vocabulary import AssignmentRole, ScheduleStatus
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment, Schedule
from oncall.infrastructure.sqlalchemy.team import SqlAlchemyTeamDirectory
from tests.conftest import create_member, create_user

DAY = date(2026, 11, 3)


def _change(role: AssignmentRole, previous: str, new: str = "Solver Pick") -> ProtectedChange:
    return ProtectedChange(
        service_date=DAY,
        role=role,
        previous_assignee_name=previous,
        new_assignee_name=new,
        source="override",
        original_assignee_name=previous,
    )


def _schedule() -> Schedule:
    return Schedule(
        name="Draft",
        starts_on=DAY,
        ends_on=DAY,
        status=ScheduleStatus.proposed,
        assignments=[
            Assignment(service_date=DAY, role=AssignmentRole.primary, assignee_name="Solver Pick"),
            Assignment(
                service_date=DAY, role=AssignmentRole.secondary, assignee_name="Solver Pick"
            ),
        ],
    )


@pytest.mark.anyio
async def test_two_change_resolutions_cannot_double_book_the_same_person(
    db: AsyncSession,
) -> None:
    """QA7 par. 8, B3 review: republishing 2026-10-26..2026-11-29 with
    "change" chosen for both 2026-11-03 primary and secondary put Julia Nowak
    on both roles at once - this used to write straight through with no
    check."""
    julia = await create_user(db, "julia", display_name="Julia Nowak")
    await create_member(db, julia, display_name="Julia Nowak")
    schedule = _schedule()
    selected_carries = [
        _change(AssignmentRole.primary, "Julia Nowak"),
        _change(AssignmentRole.secondary, "Julia Nowak"),
    ]
    conflicts = await change_resolution_conflicts(
        schedule, selected_carries, SqlAlchemyTeamDirectory(db)
    )
    assert conflicts == {
        (DAY, AssignmentRole.primary): "Ta osoba miałaby już drugi dyżur on-call tego dnia",
        (DAY, AssignmentRole.secondary): "Ta osoba miałaby już drugi dyżur on-call tego dnia",
    }


@pytest.mark.anyio
async def test_change_resolutions_for_different_people_are_clean(db: AsyncSession) -> None:
    julia = await create_user(db, "julia", display_name="Julia Nowak")
    await create_member(db, julia, display_name="Julia Nowak")
    marek = await create_user(db, "marek", display_name="Marek Nowak")
    await create_member(db, marek, display_name="Marek Nowak")
    schedule = _schedule()
    selected_carries = [
        _change(AssignmentRole.primary, "Julia Nowak"),
        _change(AssignmentRole.secondary, "Marek Nowak"),
    ]
    assert (
        await change_resolution_conflicts(schedule, selected_carries, SqlAlchemyTeamDirectory(db))
        == {}
    )
