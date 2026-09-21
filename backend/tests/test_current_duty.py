"""The dashboard must answer who, until when, who is next and how to reach them."""

from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.coverage import coverage_window, is_day_off
from oncall.domain.clock import business_today
from oncall.domain.vocabulary import AssignmentRole, ScheduleStatus, UserRole
from oncall.workdays import polish_holidays
from tests.conftest import create_member, create_published_schedule, create_user, login

TODAY = business_today()


async def _team(db: AsyncSession) -> None:
    anna = await create_user(
        db, "anna", display_name="Anna Kowalska", email="anna@example.com", phone="600100200"
    )
    marek = await create_user(db, "marek", display_name="Marek Nowak", email="marek@example.com")
    await create_member(db, anna, display_name="Anna Kowalska")
    await create_member(db, marek, display_name="Marek Nowak")


@pytest.mark.anyio
async def test_current_duty_carries_window_and_contact(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _team(db)
    await create_published_schedule(
        db,
        starts_on=TODAY,
        days=5,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Marek Nowak"],
    )
    await login(client, "anna")
    body = (await client.get("/api/v1/schedules/published")).json()

    late = next((item for item in body["current"] if item["role"] == "late_shift"), None)
    if is_day_off(TODAY, polish_holidays(TODAY, TODAY)):
        assert late is None
    else:
        assert late is not None
        assert (late["coverage_starts_at"], late["coverage_ends_at"]) == ("11:00", "19:00")

    primary = next(item for item in body["current"] if item["role"] == "primary")
    assert primary["assignee_name"] == "Anna Kowalska"
    assert primary["contact_email"] == "anna@example.com"
    assert primary["contact_phone"] == "600100200"
    assert primary["coverage_starts_at"] in ("19:00", "00:00")
    assert primary["coverage_ends_at"] in ("09:00", "24:00")
    assert primary["member_id"] is not None


@pytest.mark.anyio
async def test_next_holder_of_the_role_is_reported(client: AsyncClient, db: AsyncSession) -> None:
    await _team(db)
    # Anna today, Marek from tomorrow.
    await create_published_schedule(
        db,
        starts_on=TODAY,
        days=1,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Marek Nowak"],
        name="Dziś",
    )
    await create_published_schedule(
        db,
        starts_on=TODAY + timedelta(days=1),
        days=3,
        primary=["Marek Nowak"],
        secondary=["Anna Kowalska"],
        late_shift=["Anna Kowalska"],
        name="Od jutra",
    )
    await login(client, "anna")
    body = (await client.get("/api/v1/schedules/published")).json()

    primary = next(item for item in body["current"] if item["role"] == "primary")
    assert primary["next_assignee_name"] == "Marek Nowak"
    assert primary["next_service_date"] == (TODAY + timedelta(days=1)).isoformat()


@pytest.mark.anyio
async def test_a_viewer_gets_names_and_times_but_no_contact(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _team(db)
    await create_user(db, "widz", role=UserRole.viewer)
    await create_published_schedule(
        db,
        starts_on=TODAY,
        days=3,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Marek Nowak"],
    )
    await login(client, "widz")
    body = (await client.get("/api/v1/schedules/published")).json()

    assert body["current"], "a viewer still sees who is on duty"
    for item in body["current"]:
        assert item["contact_email"] is None
        assert item["contact_phone"] is None
        assert item["coverage_starts_at"]


@pytest.mark.anyio
async def test_superseded_schedule_still_provides_historical_effective_coverage(
    client: AsyncClient, db: AsyncSession
) -> None:
    """Superseded schedules remain input for per-slot historical resolution."""
    await _team(db)
    schedule = await create_published_schedule(
        db,
        starts_on=TODAY,
        days=3,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Marek Nowak"],
    )
    schedule.status = ScheduleStatus.superseded
    await db.commit()

    await login(client, "anna")
    response = await client.get("/api/v1/schedules/published")

    assert response.status_code == 200
    body = response.json()
    assert body["assignments"]
    assert any(item["assignee_name"] == "Anna Kowalska" for item in body["current"])


@pytest.mark.anyio
async def test_published_range_params_narrow_the_window(
    client: AsyncClient, db: AsyncSession
) -> None:
    """LOW6-08: starts_on/ends_on used to be accepted and ignored."""
    await _team(db)
    await create_published_schedule(
        db,
        starts_on=TODAY,
        days=120,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Marek Nowak"],
    )
    await login(client, "anna")

    full = (await client.get("/api/v1/schedules/published")).json()
    windowed = (
        await client.get(
            "/api/v1/schedules/published",
            params={
                "starts_on": TODAY.isoformat(),
                "ends_on": (TODAY + timedelta(days=2)).isoformat(),
            },
        )
    ).json()

    assert len(windowed["assignments"]) < len(full["assignments"])
    assert windowed["ends_on"] == (TODAY + timedelta(days=2)).isoformat()
    # The "today" fields still describe the real today, not the window start.
    assert windowed["today_is_day_off"] == full["today_is_day_off"]
    assert [d["assignee_name"] for d in windowed["current"]] == [
        d["assignee_name"] for d in full["current"]
    ]

    # A window that starts after today still reports who is on call now.
    future = (
        await client.get(
            "/api/v1/schedules/published",
            params={"starts_on": (TODAY + timedelta(days=3)).isoformat()},
        )
    ).json()
    assert future["starts_on"] == (TODAY + timedelta(days=3)).isoformat()
    assert [d["assignee_name"] for d in future["current"]] == [
        d["assignee_name"] for d in full["current"]
    ]

    bad = await client.get(
        "/api/v1/schedules/published",
        params={"starts_on": TODAY.isoformat(), "ends_on": (TODAY - timedelta(days=1)).isoformat()},
    )
    assert bad.status_code == 422

    # ends_on can only pull the horizon in, never push it past today + 90 days,
    # even though the schedule itself covers 120.
    far = (
        await client.get(
            "/api/v1/schedules/published",
            params={"ends_on": (TODAY + timedelta(days=3650)).isoformat()},
        )
    ).json()
    assert far["ends_on"] == (TODAY + timedelta(days=90)).isoformat()


def test_coverage_window_follows_the_day_type() -> None:
    saturday = date(2026, 9, 5)
    monday = date(2026, 9, 7)
    epiphany = date(2026, 1, 6)  # Tuesday, statutory holiday

    assert coverage_window(monday, set()) == ("19:00", "09:00")
    assert coverage_window(saturday, set()) == ("00:00", "24:00")
    assert coverage_window(epiphany, {epiphany}) == ("00:00", "24:00")
    # The 11-19 shift is daytime work, not on-call cover.
    assert coverage_window(monday, set(), AssignmentRole.late_shift) == ("11:00", "19:00")
    assert is_day_off(saturday, set()) is True
    assert is_day_off(monday, set()) is False
    assert is_day_off(epiphany, {epiphany}) is True
