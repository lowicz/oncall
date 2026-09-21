from datetime import date, timedelta

from oncall.domain.vocabulary import AssignmentRole, ScheduleStatus, UserRole
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment, Schedule
from tests.conftest import create_member, create_user, login


async def _draft_setup(client, db):
    monday = date(2026, 9, 7)
    anna = await create_user(db, "anna-draft", display_name="Anna")
    marek = await create_user(db, "marek-draft", display_name="Marek")
    ola = await create_user(db, "ola-draft", display_name="Ola")
    await create_member(db, anna, display_name="Anna")
    await create_member(db, marek, display_name="Marek")
    ola_member = await create_member(db, ola, display_name="Ola")
    schedule = Schedule(
        name="Szkic",
        starts_on=monday,
        ends_on=monday + timedelta(days=6),
        status=ScheduleStatus.draft,
        solver_status="OPTIMAL",
    )
    for offset in range(7):
        day = monday + timedelta(days=offset)
        schedule.assignments.extend(
            [
                Assignment(service_date=day, role=AssignmentRole.primary, assignee_name="Anna"),
                Assignment(service_date=day, role=AssignmentRole.secondary, assignee_name="Marek"),
            ]
        )
        if day.weekday() < 5:
            schedule.assignments.append(
                Assignment(
                    service_date=day,
                    role=AssignmentRole.late_shift,
                    assignee_name="Marek",
                )
            )
    db.add(schedule)
    await db.commit()
    await db.refresh(schedule)
    await create_user(db, "coordinator-draft", role=UserRole.coordinator)
    await login(client, "coordinator-draft")
    return schedule, ola_member, monday


async def test_coordinator_can_edit_one_assignment_in_draft(client, db) -> None:
    schedule, ola, monday = await _draft_setup(client, db)
    before = await client.get(f"/api/v1/scheduling/{schedule.id}/fairness-impact")
    assert before.status_code == 200, before.text
    before_ola = next(
        item for item in before.json()["projected_members"] if item["display_name"] == "Ola"
    )
    response = await client.post(
        f"/api/v1/scheduling/{schedule.id}/override",
        json={
            "expected_version": schedule.version,
            "service_date": str(monday),
            "role": "primary",
            "replacement_member_id": str(ola.id),
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["version"] == schedule.version + 1
    changed = next(
        item
        for item in body["assignments"]
        if item["service_date"] == str(monday) and item["role"] == "primary"
    )
    assert changed["assignee_name"] == "Ola"
    assert changed["is_override"] is True
    after = await client.get(f"/api/v1/scheduling/{schedule.id}/fairness-impact")
    assert after.status_code == 200, after.text
    after_ola = next(
        item for item in after.json()["projected_members"] if item["display_name"] == "Ola"
    )
    assert after.json()["schedule_version"] == body["version"]
    assert after_ola["primary"]["actual"] == before_ola["primary"]["actual"] + 1


async def test_draft_rejects_late_shift_on_day_off(client, db) -> None:
    schedule, ola, monday = await _draft_setup(client, db)
    response = await client.post(
        f"/api/v1/scheduling/{schedule.id}/override",
        json={
            "expected_version": schedule.version,
            "service_date": str(monday + timedelta(days=5)),
            "role": "late_shift",
            "replacement_member_id": str(ola.id),
        },
    )

    assert response.status_code == 422
    assert "tylko w dni robocze" in response.json()["detail"]


async def test_draft_override_warns_about_rest_rule_violation(client, db) -> None:
    schedule, ola, monday = await _draft_setup(client, db)
    version = schedule.version
    response = None
    for offset in range(4):
        response = await client.post(
            f"/api/v1/scheduling/{schedule.id}/override",
            json={
                "expected_version": version,
                "service_date": str(monday + timedelta(days=offset)),
                "role": "primary",
                "replacement_member_id": str(ola.id),
            },
        )
        assert response.status_code == 200, response.text
        version = response.json()["version"]
    assert response is not None
    warnings = response.json()["warnings"]
    assert all(item["source"] == "rules" for item in warnings), warnings
    assert any("Więcej niż 3 kolejne" in item["message"] for item in warnings)
    assert any("okresie 7 dni" in item["message"] for item in warnings)
    # A warning without a name and a date says only that something is wrong.
    assert all(ola.display_name in item["message"] for item in warnings), warnings
    assert all("Dni: " in item["message"] for item in warnings), warnings
