"""A coordinator correction may break a hard rule only knowingly: the
violations are computed before the fact, the write is refused until the
request carries `acknowledge_rule_violations: true`, and an acknowledged
correction returns them and writes them to the audit log with their rule ids."""

from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.vocabulary import AssignmentRole, UserRole
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment
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
    rules = {item["rule"] for item in checked.json()["violations"]}
    assert "three_in_seven" in rules
    magda = next(item for item in checked.json()["violations"] if item["rule"] == "three_in_seven")
    assert magda["member_name"] == "Magdalena Woźniak"
    assert "2026-09-28" in magda["days"]


def _breaking_override(schedule, members: dict, **extra) -> dict:
    return {
        "schedule_id": str(schedule.id),
        "expected_version": schedule.version,
        "service_date": "2026-09-28",
        "role": "secondary",
        "replacement_member_id": str(members["Magdalena Woźniak"].id),
        **extra,
    }


@pytest.mark.anyio
@pytest.mark.usefixtures("frozen_clock")  # the overridden duty must still lie ahead
@pytest.mark.parametrize("acknowledgement", [{}, {"acknowledge_rule_violations": False}])
async def test_override_that_breaks_a_rule_is_refused_without_acknowledgement(
    client: AsyncClient, db: AsyncSession, acknowledgement: dict
) -> None:
    members = await _team(db)
    schedule = await _roster(db)
    await login(client, "koord")

    response = await client.post(
        "/api/v1/calendar/override", json=_breaking_override(schedule, members, **acknowledgement)
    )

    assert response.status_code == 409, response.text
    detail = response.json()["detail"]
    assert detail["reason"] == "RULE_VIOLATIONS"
    assert detail["message"] and detail["next_step"]
    three_in_seven = next(item for item in detail["violations"] if item["rule"] == "three_in_seven")
    assert three_in_seven["member_name"] == "Magdalena Woźniak"
    assert three_in_seven["message"]
    assert "2026-09-28" in three_in_seven["days"]
    # Nothing was written: no new version, no hand-over, no audit entry.
    await db.refresh(schedule)
    assert schedule.version == 1
    held = await db.scalar(
        select(Assignment.assignee_name).where(
            Assignment.schedule_id == schedule.id,
            Assignment.service_date == date(2026, 9, 28),
            Assignment.role == AssignmentRole.secondary,
        )
    )
    assert held == "Julia Kowal"
    assert (
        await db.scalars(select(AuditEvent).where(AuditEvent.action == "schedule.override"))
    ).all() == []


@pytest.mark.anyio
@pytest.mark.usefixtures("frozen_clock")  # the overridden duty must still lie ahead
async def test_acknowledged_override_returns_violations_and_audits_the_rule(
    client: AsyncClient, db: AsyncSession
) -> None:
    members = await _team(db)
    schedule = await _roster(db)
    await login(client, "koord")

    response = await client.post(
        "/api/v1/calendar/override",
        json=_breaking_override(schedule, members, acknowledge_rule_violations=True),
    )

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
    assert "świadome naruszenie reguł: " in events[0].summary
    assert "więcej niż 3 dyżury on-call w okresie 7 dni" in events[0].summary


@pytest.mark.anyio
@pytest.mark.usefixtures("frozen_clock")  # the overridden duty must still lie ahead
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
    assert checked.json() == {"violations": [], "ends_handover": None}

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


def _breaking_batch(schedule, members: dict, **extra) -> dict:
    return {
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
        **extra,
    }


@pytest.mark.anyio
async def test_batch_override_check_reports_rules_without_writing(
    client: AsyncClient, db: AsyncSession
) -> None:
    members = await _team(db)
    schedule = await _roster(db)
    await login(client, "koord")
    batch = _breaking_batch(schedule, members)

    response = await client.post(
        "/api/v1/calendar/override/batch/check",
        json={
            "batches": [{"schedule_id": batch["schedule_id"], "assignments": batch["assignments"]}]
        },
    )

    assert response.status_code == 200, response.text
    assert "same_day_oncall" in {item["rule"] for item in response.json()["violations"]}
    assert response.json()["ends_handover"] is None
    await db.refresh(schedule)
    assert schedule.version == 1
    assert (
        await db.scalars(select(AuditEvent).where(AuditEvent.action == "schedule.override_batch"))
    ).all() == []


@pytest.mark.anyio
async def test_batch_override_check_sees_a_rule_across_two_schedules(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _team(db)
    ewa = await create_member(db, await create_user(db, "ewa"), display_name="Ewa Lis")
    first = await _roster(db)
    second = await create_published_schedule(
        db, starts_on=date(2026, 9, 29), days=7, primary=["Julia Kowal"], name="Next week"
    )
    await login(client, "koord")

    def batch(schedule, days: list[str]) -> dict:
        return {
            "schedule_id": str(schedule.id),
            "assignments": [
                {"service_date": day, "role": "primary", "replacement_member_id": str(ewa.id)}
                for day in days
            ],
        }

    first_batch = batch(first, ["2026-09-28"])
    second_batch = batch(second, ["2026-09-29", "2026-09-30", "2026-10-01"])

    async def check(*batches: dict) -> list[tuple[str, str]]:
        response = await client.post(
            "/api/v1/calendar/override/batch/check", json={"batches": list(batches)}
        )
        assert response.status_code == 200, response.text
        return [(item["rule"], item["member_name"]) for item in response.json()["violations"]]

    # Each week alone is clean; saved one after the other, Ewa has four days in a row.
    assert await check(first_batch) == []
    assert await check(second_batch) == []
    assert ("max_consecutive", "Ewa Lis") in await check(first_batch, second_batch)

    repeated = await client.post(
        "/api/v1/calendar/override/batch/check",
        json={"batches": [first_batch, first_batch]},
    )
    assert repeated.status_code == 422, repeated.text


@pytest.mark.anyio
async def test_batch_override_that_breaks_a_rule_is_refused_without_acknowledgement(
    client: AsyncClient, db: AsyncSession
) -> None:
    members = await _team(db)
    schedule = await _roster(db)
    await login(client, "koord")

    response = await client.post(
        "/api/v1/calendar/override/batch", json=_breaking_batch(schedule, members)
    )

    assert response.status_code == 409, response.text
    detail = response.json()["detail"]
    assert detail["reason"] == "RULE_VIOLATIONS"
    assert "same_day_oncall" in {item["rule"] for item in detail["violations"]}
    await db.refresh(schedule)
    assert schedule.version == 1


@pytest.mark.anyio
async def test_batch_override_reports_violations_created_by_the_whole_batch(
    client: AsyncClient, db: AsyncSession
) -> None:
    members = await _team(db)
    schedule = await _roster(db)
    await login(client, "koord")

    response = await client.post(
        "/api/v1/calendar/override/batch",
        json=_breaking_batch(schedule, members, acknowledge_rule_violations=True),
    )

    assert response.status_code == 200, response.text
    assert "same_day_oncall" in {
        violation["rule"]
        for assignment in response.json()
        for violation in assignment["rule_violations"]
    }
    event = await db.scalar(
        select(AuditEvent).where(AuditEvent.action == "schedule.override_batch")
    )
    assert event is not None
    assert "świadome naruszenie reguł: " in event.summary
    assert "ta sama osoba ma oba dyżury on-call tego dnia" in event.summary


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
    rules = {item["rule"] for item in checked.json()["violations"]}
    assert "late_shift_anchor" not in rules, checked.json()["violations"]


@pytest.mark.anyio
@pytest.mark.usefixtures("frozen_clock")  # the overridden duty must still lie ahead
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
