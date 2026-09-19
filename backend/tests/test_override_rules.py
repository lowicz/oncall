"""D3/Z9: the coordinator override proceeds even when it breaks a hard rule,
but the violations are computed before the fact, returned in the response and
written to the audit log with their rule ids."""

from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.models import Assignment, AssignmentRole, AuditEvent, UserRole
from tests.conftest import (
    create_member,
    create_published_schedule,
    create_user,
    login,
)

START = date(2026, 9, 22)  # Tuesday; the 26th-27th are the weekend


async def _team(db: AsyncSession) -> dict:
    members = {}
    for username, name in (
        ("magda", "Magdalena Woźniak"),
        ("julia", "Julia Kowal"),
        ("ola", "Ola Zalewska"),
    ):
        user = await create_user(db, username, display_name=name)
        members[name] = await create_member(db, user, display_name=name)
    await create_user(db, "koord", role=UserRole.coordinator)
    return members


async def _roster(db: AsyncSession):
    secondary = [
        "Magdalena Woźniak",
        "Magdalena Woźniak",
        "Magdalena Woźniak",
        "Ola Zalewska",
        "Ola Zalewska",
        "Ola Zalewska",
        "Julia Kowal",
    ]
    return await create_published_schedule(
        db,
        starts_on=START,
        days=7,
        primary=["Ola Zalewska"],
        secondary=secondary,
        late_shift=secondary,
    )


@pytest.mark.anyio
async def test_override_check_names_the_rules_before_the_fact(
    client: AsyncClient, db: AsyncSession
) -> None:
    members = await _team(db)
    await _roster(db)
    await login(client, "koord")

    checked = await client.post(
        "/api/v1/calendar/override/check",
        json={
            "service_date": "2026-09-28",
            "role": "secondary",
            "replacement_member_id": str(members["Magdalena Woźniak"].id),
        },
    )

    assert checked.status_code == 200, checked.text
    rules = {item["rule"] for item in checked.json()}
    assert "three_in_seven" in rules
    magda = next(item for item in checked.json() if item["rule"] == "three_in_seven")
    assert magda["member_name"] == "Magdalena Woźniak"
    assert "2026-09-28" in magda["days"]


@pytest.mark.anyio
async def test_override_proceeds_returns_violations_and_audits_the_rule(
    client: AsyncClient, db: AsyncSession
) -> None:
    members = await _team(db)
    schedule = await _roster(db)
    await login(client, "koord")

    response = await client.post(
        "/api/v1/calendar/override",
        json={
            "schedule_id": str(schedule.id),
            "expected_version": schedule.version,
            "service_date": "2026-09-28",
            "role": "secondary",
            "replacement_member_id": str(members["Magdalena Woźniak"].id),
        },
    )

    # The coordinator is warned, not blocked: the operation goes through.
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["assignee_name"] == "Magdalena Woźniak"
    rules = {item["rule"] for item in body["rule_violations"]}
    assert "three_in_seven" in rules

    events = (
        await db.scalars(select(AuditEvent).where(AuditEvent.action == "schedule.override"))
    ).all()
    assert len(events) == 1
    details = events[0].details
    assert "three_in_seven" in {item["rule"] for item in details["rule_violations"]}
    assert "three_in_seven" in events[0].summary


@pytest.mark.anyio
async def test_clean_override_returns_no_violations(client: AsyncClient, db: AsyncSession) -> None:
    members = await _team(db)
    schedule = await _roster(db)
    await login(client, "koord")

    checked = await client.post(
        "/api/v1/calendar/override/check",
        json={
            "service_date": "2026-09-23",
            "role": "primary",
            "replacement_member_id": str(members["Julia Kowal"].id),
        },
    )
    assert checked.status_code == 200, checked.text
    assert checked.json() == []

    response = await client.post(
        "/api/v1/calendar/override",
        json={
            "schedule_id": str(schedule.id),
            "expected_version": schedule.version,
            "service_date": "2026-09-23",
            "role": "primary",
            "replacement_member_id": str(members["Julia Kowal"].id),
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["rule_violations"] == []


@pytest.mark.anyio
async def test_batch_override_reports_violations_created_by_the_whole_batch(
    client: AsyncClient, db: AsyncSession
) -> None:
    members = await _team(db)
    schedule = await _roster(db)
    await login(client, "koord")

    response = await client.post(
        "/api/v1/calendar/override/batch",
        json={
            "schedule_id": str(schedule.id),
            "expected_version": schedule.version,
            "reason": "Test atomowej korekty wsadowej",
            "assignments": [
                {
                    "service_date": "2026-09-28",
                    "role": "primary",
                    "replacement_member_id": str(members["Magdalena Woźniak"].id),
                },
                {
                    "service_date": "2026-09-28",
                    "role": "secondary",
                    "replacement_member_id": str(members["Magdalena Woźniak"].id),
                },
            ],
        },
    )

    assert response.status_code == 200, response.text
    assert "same_day_oncall" in {
        violation["rule"]
        for assignment in response.json()
        for violation in assignment["rule_violations"]
    }


@pytest.mark.anyio
async def test_override_check_does_not_invent_an_anchor_split(
    client: AsyncClient, db: AsyncSession
) -> None:
    """QA7 par. 8, D3 review: `/calendar/override/check` used to check only
    the clicked slot, so a secondary-role override that in reality moves
    11-19 along with it (decision D1, replacement eligible for both roles)
    looked like it split the anchor from its role - a violation the write
    endpoint (which does account for the coupled move) never actually
    produces, so confirming it would not have broken what the dialog warned
    about."""
    members = await _team(db)
    await _roster(db)
    await login(client, "koord")

    checked = await client.post(
        "/api/v1/calendar/override/check",
        json={
            "service_date": "2026-09-23",
            "role": "secondary",
            "replacement_member_id": str(members["Julia Kowal"].id),
        },
    )
    assert checked.status_code == 200, checked.text
    rules = {item["rule"] for item in checked.json()}
    assert "late_shift_anchor" not in rules, checked.json()


@pytest.mark.anyio
async def test_override_of_anchor_role_moves_late_shift_in_one_version(
    client: AsyncClient, db: AsyncSession
) -> None:
    members = await _team(db)
    schedule = await _roster(db)
    await login(client, "koord")

    response = await client.post(
        "/api/v1/calendar/override",
        json={
            "schedule_id": str(schedule.id),
            "expected_version": schedule.version,
            "service_date": "2026-09-23",
            "role": "secondary",
            "replacement_member_id": str(members["Julia Kowal"].id),
        },
    )

    assert response.status_code == 200, response.text
    moved = (
        await db.scalars(
            select(Assignment).where(
                Assignment.schedule_id == schedule.id,
                Assignment.service_date == date(2026, 9, 23),
                Assignment.role.in_((AssignmentRole.secondary, AssignmentRole.late_shift)),
            )
        )
    ).all()
    assert {item.assignee_name for item in moved} == {"Julia Kowal"}
    await db.refresh(schedule)
    assert schedule.version == 2
