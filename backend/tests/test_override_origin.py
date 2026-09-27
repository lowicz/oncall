"""Who a manual change displaced is kept on the slot itself, by identity.

A republish offers every hand-made change in force back to the coordinator
and carries it across only when the new draft gives the slot to the person
the change displaced. That person used to be read back from the audit log by
display name, so renaming them between the change and the republish turned a
safe carry into a conflict and the correction was lost.
"""

from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.clock import business_today
from oncall.domain.overrides.models import UNSTAFFED
from oncall.domain.scheduling.models import CarriedChange
from oncall.domain.team import Member
from oncall.domain.vocabulary import AssignmentRole, ScheduleStatus, UserRole
from oncall.infrastructure.sqlalchemy.admin import SqlAlchemyRotation
from oncall.infrastructure.sqlalchemy.roster import SqlAlchemyPublishedRoster
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment, Schedule
from oncall.infrastructure.sqlalchemy.scheduling_schedules import SqlAlchemySchedules
from oncall.infrastructure.sqlalchemy.team_models import TeamMember
from tests.conftest import create_member, create_published_schedule, create_user, login


def _next_monday():
    today = business_today()
    return today + timedelta(days=(7 - today.weekday()) % 7 or 7)


async def _team(db: AsyncSession) -> dict[str, TeamMember]:
    members = {}
    for username, name in (
        ("anna", "Anna Kowalska"),
        ("marek", "Marek Nowak"),
        ("ola", "Ola Wiśniewska"),
    ):
        user = await create_user(db, username, display_name=name)
        members[name] = await create_member(db, user, display_name=name)
    return members


def _as_member(row: TeamMember) -> Member:
    return Member(
        id=row.id,
        display_name=row.display_name,
        user_id=row.user_id,
        active_from=row.active_from,
        active_until=row.active_until,
        eligibility=(),
        availability=(),
    )


async def _published_week(db: AsyncSession, members: dict[str, TeamMember]) -> Schedule:
    schedule = await create_published_schedule(
        db,
        starts_on=_next_monday(),
        days=7,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Marek Nowak"],
    )
    for row in await db.scalars(select(Assignment).where(Assignment.schedule_id == schedule.id)):
        row.member_id = members[row.assignee_name].id
    await db.commit()
    return schedule


async def _slot(db: AsyncSession, schedule_id, day, role) -> Assignment:
    row = await db.scalar(
        select(Assignment)
        .where(
            Assignment.schedule_id == schedule_id,
            Assignment.service_date == day,
            Assignment.role == role,
        )
        .execution_options(populate_existing=True)
    )
    assert row is not None
    return row


@pytest.mark.anyio
async def test_the_first_hand_over_records_the_holder_and_later_ones_keep_it(
    db: AsyncSession,
) -> None:
    members = await _team(db)
    schedule = await _published_week(db, members)
    day = schedule.starts_on
    roster = SqlAlchemyPublishedRoster(db)

    await roster.hand_over(
        schedule.id, [(day, AssignmentRole.primary)], _as_member(members["Ola Wiśniewska"])
    )
    await db.commit()
    await roster.hand_over(
        schedule.id, [(day, AssignmentRole.primary)], _as_member(members["Marek Nowak"])
    )
    await db.commit()

    slot = await _slot(db, schedule.id, day, AssignmentRole.primary)
    assert (slot.member_id, slot.is_override) == (members["Marek Nowak"].id, True)
    assert (slot.original_member_id, slot.original_assignee_name) == (
        members["Anna Kowalska"].id,
        "Anna Kowalska",
    )


@pytest.mark.anyio
async def test_a_slot_a_hand_over_creates_had_nobody(db: AsyncSession) -> None:
    members = await _team(db)
    schedule = await _published_week(db, members)
    sunday = schedule.ends_on
    roster = SqlAlchemyPublishedRoster(db)
    missing = await _slot(db, schedule.id, sunday, AssignmentRole.late_shift)
    await db.delete(missing)
    await db.commit()

    await roster.hand_over(
        schedule.id, [(sunday, AssignmentRole.late_shift)], _as_member(members["Ola Wiśniewska"])
    )
    await db.commit()

    slot = await _slot(db, schedule.id, sunday, AssignmentRole.late_shift)
    assert (slot.original_member_id, slot.original_assignee_name) == (None, UNSTAFFED)


@pytest.mark.anyio
async def test_a_draft_correction_records_the_generated_holder_and_a_carry_leaves_it(
    db: AsyncSession,
) -> None:
    members = await _team(db)
    schedule = await _published_week(db, members)
    day = schedule.starts_on
    store = SqlAlchemySchedules(db)
    await store.schedule_to_correct(schedule.id)
    await store.correct(
        schedule.id, (day, AssignmentRole.primary), _as_member(members["Ola Wiśniewska"])
    )
    await store.carry(
        schedule.id,
        [
            CarriedChange((day, AssignmentRole.primary), "Marek Nowak", members["Marek Nowak"].id),
            CarriedChange(
                (day, AssignmentRole.secondary), "Ola Wiśniewska", members["Ola Wiśniewska"].id
            ),
        ],
    )
    await db.commit()

    corrected = await _slot(db, schedule.id, day, AssignmentRole.primary)
    assert (corrected.member_id, corrected.original_member_id) == (
        members["Marek Nowak"].id,
        members["Anna Kowalska"].id,
    )
    carried = await _slot(db, schedule.id, day, AssignmentRole.secondary)
    assert (carried.is_override, carried.original_assignee_name) == (True, None)


@pytest.mark.anyio
async def test_a_rename_and_a_pseudonym_follow_the_origin(db: AsyncSession) -> None:
    members = await _team(db)
    schedule = await _published_week(db, members)
    day = schedule.starts_on
    await SqlAlchemyPublishedRoster(db).hand_over(
        schedule.id, [(day, AssignmentRole.primary)], _as_member(members["Ola Wiśniewska"])
    )
    imported = await _slot(db, schedule.id, day + timedelta(days=1), AssignmentRole.primary)
    imported.original_member_id = None
    imported.original_assignee_name = "Anna Kowalska"
    await db.commit()
    rotation = SqlAlchemyRotation(db)

    await rotation.rename_member(members["Anna Kowalska"].id, "Anna Zielińska")
    await db.commit()
    renamed = await _slot(db, schedule.id, day, AssignmentRole.primary)
    assert renamed.original_assignee_name == "Anna Zielińska"

    await rotation.pseudonymise_member(members["Anna Kowalska"].id, "Osoba 1")
    await db.commit()
    assert (await _slot(db, schedule.id, day, AssignmentRole.primary)).original_assignee_name == (
        "Osoba 1"
    )


@pytest.mark.anyio
@pytest.mark.parametrize("renamed", [False, True])
async def test_a_rename_between_a_correction_and_a_republish_keeps_the_carry(
    client: AsyncClient, db: AsyncSession, renamed: bool
) -> None:
    """The reported case, end to end: a coordinator corrects the published
    week, an administrator changes the displaced person's surname, and the
    regenerated draft gives the slot back to that person. The correction is
    a safe carry either way."""
    members = await _team(db)
    anna_account = members["Anna Kowalska"].user_id
    await create_user(db, "koord", role=UserRole.coordinator)
    await create_user(db, "adm", role=UserRole.admin)
    published = await _published_week(db, members)
    start = published.starts_on
    draft = Schedule(
        name="Szkic",
        starts_on=start,
        ends_on=start + timedelta(days=6),
        status=ScheduleStatus.proposed,
        solver_status="OPTIMAL",
    )
    for offset in range(7):
        for role, name in (
            (AssignmentRole.primary, "Anna Kowalska"),
            (AssignmentRole.secondary, "Marek Nowak"),
            (AssignmentRole.late_shift, "Marek Nowak"),
        ):
            draft.assignments.append(
                Assignment(
                    service_date=start + timedelta(days=offset),
                    role=role,
                    assignee_name=name,
                    member_id=members[name].id,
                )
            )
    db.add(draft)
    await db.commit()

    await login(client, "koord")
    corrected = await client.post(
        "/api/v1/calendar/override",
        json={
            "schedule_id": str(published.id),
            "expected_version": published.version,
            "service_date": start.isoformat(),
            "role": "primary",
            "replacement_member_id": str(members["Ola Wiśniewska"].id),
        },
    )
    assert corrected.status_code == 200, corrected.text
    if renamed:
        await login(client, "adm")
        renaming = await client.patch(
            f"/api/v1/admin/users/{anna_account}", json={"last_name": "Zielińska"}
        )
        assert renaming.status_code == 200, renaming.text
        await login(client, "koord")

    preview = await client.get(f"/api/v1/scheduling/{draft.id}/publish-preview")

    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["lost_changes"] == []
    assert [
        (item["service_date"], item["role"], item["original_assignee_name"], item["reason"])
        for item in body["carried_changes"]
    ] == [
        (
            start.isoformat(),
            "primary",
            "Anna Zielińska" if renamed else "Anna Kowalska",
            None,
        )
    ]
