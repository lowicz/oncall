from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.clock import business_today
from oncall.domain.scheduling.planning import range_end, suggested_start
from oncall.models import Schedule, ScheduleStatus, UserRole
from tests.conftest import create_user, login


@pytest.mark.parametrize(
    ("starts_on", "ends_on"),
    [
        (date(2026, 9, 7), date(2026, 10, 4)),
        (date(2026, 9, 8), date(2026, 10, 11)),
        (date(2026, 9, 13), date(2026, 10, 11)),
    ],
)
def test_range_ends_after_four_full_weeks(starts_on: date, ends_on: date) -> None:
    assert range_end(starts_on) == ends_on


@pytest.mark.anyio
async def test_suggested_range_starts_after_contiguous_published_coverage(
    client: AsyncClient, db: AsyncSession
) -> None:
    await create_user(db, "koord", role=UserRole.coordinator)
    today = business_today()
    schedules = [
        Schedule(
            name="Pierwszy",
            starts_on=today - timedelta(days=2),
            ends_on=today + timedelta(days=3),
            status=ScheduleStatus.published,
        ),
        Schedule(
            name="Drugi",
            starts_on=today + timedelta(days=4),
            ends_on=today + timedelta(days=6),
            status=ScheduleStatus.published,
        ),
        Schedule(
            name="Ignorowany szkic",
            starts_on=today + timedelta(days=7),
            ends_on=today + timedelta(days=20),
            status=ScheduleStatus.draft,
        ),
    ]
    db.add_all(schedules)
    await db.commit()
    await login(client, "koord")

    response = await client.get("/api/v1/scheduling/suggested-range")

    assert response.status_code == 200
    expected_start = suggested_start(today, schedules[:2])
    assert response.json() == {
        "first_uncovered": expected_start.isoformat(),
        "starts_on": expected_start.isoformat(),
        "ends_on": range_end(expected_start).isoformat(),
    }


@pytest.mark.anyio
async def test_suggested_range_starts_today_without_coverage(
    client: AsyncClient, db: AsyncSession
) -> None:
    await create_user(db, "koord", role=UserRole.coordinator)
    await login(client, "koord")

    response = await client.get("/api/v1/scheduling/suggested-range")

    assert response.status_code == 200
    assert response.json()["first_uncovered"] == business_today().isoformat()
    assert response.json()["starts_on"] == business_today().isoformat()


def test_uncovered_saturday_starts_the_whole_day_off_block() -> None:
    saturday = date(2026, 9, 12)
    assert suggested_start(saturday, []) == saturday


def test_sunday_after_covered_saturday_starts_on_monday() -> None:
    saturday = date(2026, 9, 12)
    covered_saturday = Schedule(
        name="Obsadzona sobota",
        starts_on=saturday,
        ends_on=saturday,
        status=ScheduleStatus.published,
    )
    assert suggested_start(saturday + timedelta(days=1), [covered_saturday]) == date(2026, 9, 14)


@pytest.mark.anyio
async def test_suggested_range_treats_imported_history_as_coverage(
    client: AsyncClient, db: AsyncSession
) -> None:
    await create_user(db, "koord", role=UserRole.coordinator)
    today = business_today()
    imported = Schedule(
        name="Import historii: historia.csv",
        starts_on=today - timedelta(days=10),
        ends_on=today + timedelta(days=3),
        status=ScheduleStatus.superseded,
    )
    db.add(imported)
    await db.commit()
    await login(client, "koord")

    response = await client.get("/api/v1/scheduling/suggested-range")

    assert response.status_code == 200
    assert response.json()["starts_on"] == suggested_start(today, [imported]).isoformat()


@pytest.mark.anyio
async def test_generation_request_rejects_unknown_fields(
    client: AsyncClient, db: AsyncSession
) -> None:
    await create_user(db, "koord", role=UserRole.coordinator)
    await login(client, "koord")

    response = await client.post(
        "/api/v1/scheduling/runs",
        json={
            "starts_on": business_today().isoformat(),
            "ends_on": (business_today() + timedelta(days=27)).isoformat(),
            "rotation_mode": "daily",
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"][0]["type"] == "extra_forbidden"
