"""Trwające generowanie da się odnaleźć po przeładowaniu strony (MED5-11).

Rekord zadania miał `status = running`, ale nie było endpointu, który by go
znalazł bez znajomości identyfikatora. Ekran pokazywał pusty formularz, a
naturalną reakcją jest uruchomienie generowania drugi raz (LOW5-09).
"""

from datetime import date

from oncall.domain.vocabulary import UserRole
from oncall.infrastructure.sqlalchemy.scheduling_models import ScheduleRun
from tests.conftest import create_user, login


async def _runs(db, owner_id, other_id) -> None:
    db.add_all(
        (
            ScheduleRun(
                starts_on=date(2026, 11, 2),
                ends_on=date(2026, 11, 29),
                requested_by_id=owner_id,
                status="running",
                progress=30,
            ),
            ScheduleRun(
                starts_on=date(2026, 10, 1),
                ends_on=date(2026, 10, 28),
                requested_by_id=owner_id,
                status="completed",
                progress=100,
            ),
            ScheduleRun(
                starts_on=date(2026, 12, 1),
                ends_on=date(2026, 12, 28),
                requested_by_id=other_id,
                status="running",
                progress=30,
            ),
        )
    )
    await db.commit()


async def test_running_generation_is_listed_for_its_own_coordinator(client, db) -> None:
    owner = await create_user(db, "koord.run", role=UserRole.coordinator)
    other = await create_user(db, "koord.run2", role=UserRole.coordinator)
    await _runs(db, owner.id, other.id)

    await login(client, "koord.run")
    response = await client.get("/api/v1/scheduling/runs")
    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body) == 1, body
    assert body[0]["status"] == "running"
    assert body[0]["progress"] == 30
    # The bar does not move during the solve, so the screen needs these two.
    assert body[0]["created_at"]
    assert body[0]["solve_seconds"] > 0


async def test_a_finished_generation_is_not_offered_for_resuming(client, db) -> None:
    owner = await create_user(db, "koord.run", role=UserRole.coordinator)
    other = await create_user(db, "koord.run2", role=UserRole.coordinator)
    await _runs(db, owner.id, other.id)

    await login(client, "koord.run")
    completed = await client.get("/api/v1/scheduling/runs", params={"status": "completed"})
    assert [item["status"] for item in completed.json()] == ["completed"]
    assert all(
        item["status"] != "completed"
        for item in (await client.get("/api/v1/scheduling/runs")).json()
    )


async def test_members_cannot_list_generation_runs(client, db) -> None:
    owner = await create_user(db, "koord.run", role=UserRole.coordinator)
    await create_user(db, "czlonek.run", role=UserRole.member)
    await _runs(db, owner.id, owner.id)

    await login(client, "czlonek.run")
    response = await client.get("/api/v1/scheduling/runs")
    assert response.status_code == 403, response.text
