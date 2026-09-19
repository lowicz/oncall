"""B3 review (QA7 par. 8): a republish's "change" resolution used to write
the previous assignee straight back with no rule check at all, and the
mechanism that recovers "who a slot's assignee was replacing" only ever read
one action's `summary` text, missing batch corrections, draft corrections and
an anchor-role override's coupled 11-19 partner entirely."""

from datetime import date

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.scheduling.models import ProtectedChange
from oncall.domain.scheduling.publication import (
    change_resolution_conflicts,
    override_original_assignees,
)
from oncall.infrastructure.sqlalchemy.scheduling_changes import SqlAlchemyChangeLog
from oncall.infrastructure.sqlalchemy.team import SqlAlchemyTeamDirectory
from oncall.models import (
    Assignment,
    AssignmentRole,
    AuditEvent,
    Schedule,
    ScheduleStatus,
)
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


@pytest.mark.anyio
async def test_original_assignee_recovered_from_a_batch_correction(db: AsyncSession) -> None:
    """The offboarding wizard (D4) writes `schedule.override_batch`, which
    `override_original_assignees` used to ignore entirely."""
    old_schedule_id = "11111111-1111-1111-1111-111111111111"
    db.add(
        AuditEvent(
            actor_label="Admin",
            action="schedule.override_batch",
            entity_type="schedule",
            entity_id=old_schedule_id,
            summary="Przepisano wsadowo 1 dyżur",
            details={
                "reason": "offboarding",
                "slots": [f"{DAY.isoformat()}:secondary"],
                "moves": [
                    {
                        "service_date": DAY.isoformat(),
                        "role": "secondary",
                        "previous_assignee_name": "Halina Szymańska",
                    }
                ],
            },
        )
    )
    await db.commit()

    result = await override_original_assignees(SqlAlchemyChangeLog(db), {old_schedule_id})
    assert result[(old_schedule_id, DAY, AssignmentRole.secondary)] == "Halina Szymańska"


@pytest.mark.anyio
async def test_original_assignee_recovered_for_a_coupled_anchor_override(
    db: AsyncSession,
) -> None:
    """An anchor-role override moves 11-19 along with it (decision D1); the
    partner slot used to have no recorded origin at all."""
    old_schedule_id = "22222222-2222-2222-2222-222222222222"
    db.add(
        AuditEvent(
            actor_label="Koordynator",
            action="schedule.override",
            entity_type="schedule",
            entity_id=old_schedule_id,
            summary=f"Override {DAY} · secondary: Celina Mazur → Dawid Lewandowski",
            details={
                "service_date": DAY.isoformat(),
                "role": "secondary",
                "reason": None,
                "historical": False,
                "moves": [
                    {
                        "service_date": DAY.isoformat(),
                        "role": "secondary",
                        "previous_assignee_name": "Celina Mazur",
                    },
                    {
                        "service_date": DAY.isoformat(),
                        "role": "late_shift",
                        "previous_assignee_name": "Celina Mazur",
                    },
                ],
                "rule_violations": [],
            },
        )
    )
    await db.commit()

    result = await override_original_assignees(SqlAlchemyChangeLog(db), {old_schedule_id})
    assert result[(old_schedule_id, DAY, AssignmentRole.secondary)] == "Celina Mazur"
    assert result[(old_schedule_id, DAY, AssignmentRole.late_shift)] == "Celina Mazur"


@pytest.mark.anyio
async def test_original_assignee_falls_back_to_the_old_summary_parse(db: AsyncSession) -> None:
    """Events written before the `moves` field existed stay recoverable."""
    old_schedule_id = "33333333-3333-3333-3333-333333333333"
    db.add(
        AuditEvent(
            actor_label="Koordynator",
            action="schedule.override",
            entity_type="schedule",
            entity_id=old_schedule_id,
            summary=f"Override {DAY} · primary: Igor Wójcik → Tomasz Krawczyk",
            details={"service_date": DAY.isoformat(), "role": "primary"},
        )
    )
    await db.commit()

    result = await override_original_assignees(SqlAlchemyChangeLog(db), {old_schedule_id})
    assert result[(old_schedule_id, DAY, AssignmentRole.primary)] == "Igor Wójcik"


@pytest.mark.anyio
async def test_override_carried_is_not_read_as_a_fresh_origin(db: AsyncSession) -> None:
    """`schedule.override_carried` records the *result* of this recovery, not
    a new input to it - counting it too would let a carried change launder
    into looking like its own original."""
    old_schedule_id = "44444444-4444-4444-4444-444444444444"
    db.add(
        AuditEvent(
            actor_label="Koordynator",
            action="schedule.override_carried",
            entity_type="schedule",
            entity_id=old_schedule_id,
            summary=f"Przeniesiono zmianę {DAY} · secondary: Ktoś → Ktoś Inny",
            details={"service_date": DAY.isoformat(), "role": "secondary", "source": "swap"},
        )
    )
    await db.commit()

    assert await override_original_assignees(SqlAlchemyChangeLog(db), {old_schedule_id}) == {}
