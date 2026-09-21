"""Publishing a shorter range must not blank out the days around it.

Reported scenario: a month is published, then the second fortnight is
regenerated and published; the first fortnight disappears from the app.
"""

from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.clock import business_today
from oncall.domain.vocabulary import ScheduleStatus, UserRole
from oncall.infrastructure.sqlalchemy.scheduling_models import Schedule
from tests.conftest import (
    create_member,
    create_published_schedule,
    create_user,
    generate_draft_directly,
    login,
)

MONTH_START = business_today()
MONTH_END = MONTH_START + timedelta(days=29)
SECOND_HALF_START = MONTH_START + timedelta(days=15)


async def _team(db: AsyncSession) -> None:
    for username, name in (
        ("anna", "Anna Kowalska"),
        ("marek", "Marek Nowak"),
        ("ola", "Ola Wiśniewska"),
        ("dawid", "Dawid Zieliński"),
    ):
        user = await create_user(db, username, display_name=name)
        await create_member(db, user, display_name=name)
    await create_user(db, "koord", role=UserRole.coordinator)


async def _publish_second_half(client: AsyncClient, db: AsyncSession) -> dict:
    # The fixture schedule assigns one name per role for the whole month
    # (create_published_schedule with a single-element list), which the
    # rest-rule gate (tor A1/B1) correctly flags; one test also has no
    # published range before the second half, triggering the gap gate (D6).
    # Acknowledging either does not change which assignments get published.
    draft = await generate_draft_directly(db, "koord", SECOND_HALF_START, MONTH_END)
    proposed = await client.post(
        f"/api/v1/scheduling/{draft['id']}/propose",
        json={"expected_version": draft["version"]},
    )
    assert proposed.status_code == 200, proposed.text
    published = await client.post(
        f"/api/v1/scheduling/{draft['id']}/publish",
        json={
            "expected_version": proposed.json()["version"],
            "acknowledge_rest_violations": True,
            "acknowledge_gap": True,
        },
    )
    assert published.status_code == 200, published.text
    return published.json()


@pytest.mark.anyio
async def test_first_half_survives_republishing_the_second(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _team(db)
    await create_published_schedule(
        db,
        starts_on=MONTH_START,
        days=30,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Ola Wiśniewska"],
        name="Cały miesiąc",
    )
    await login(client, "koord")
    await _publish_second_half(client, db)

    calendar = await client.get(
        "/api/v1/calendar",
        params={"starts_on": MONTH_START.isoformat(), "ends_on": MONTH_END.isoformat()},
    )
    assert calendar.status_code == 200, calendar.text
    covered = {
        item["service_date"] for item in calendar.json()["assignments"] if item["role"] == "primary"
    }
    missing = [
        (MONTH_START + timedelta(days=offset)).isoformat()
        for offset in range(30)
        if (MONTH_START + timedelta(days=offset)).isoformat() not in covered
    ]
    assert missing == [], f"days lost their primary after a partial republish: {missing}"


@pytest.mark.anyio
async def test_today_still_resolves_after_republishing_a_later_range(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _team(db)
    await create_published_schedule(
        db,
        starts_on=MONTH_START,
        days=30,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Ola Wiśniewska"],
        name="Cały miesiąc",
    )
    await login(client, "koord")
    await _publish_second_half(client, db)

    current = await client.get("/api/v1/schedules/published")
    assert current.status_code == 200, current.text
    today = MONTH_START.isoformat()
    roles = {
        item["role"] for item in current.json()["assignments"] if item["service_date"] == today
    }
    assert "primary" in roles, "today lost its primary after republishing a later range"


@pytest.mark.anyio
async def test_a_fully_covered_schedule_is_still_superseded(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _team(db)
    old = await create_published_schedule(
        db,
        starts_on=SECOND_HALF_START,
        days=15,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Ola Wiśniewska"],
        name="Druga połowa, stara wersja",
    )
    await login(client, "koord")
    await _publish_second_half(client, db)

    # Select the column, not the entity, so this session's identity map cannot
    # hand back the pre-publication state.
    status = await db.scalar(select(Schedule.status).where(Schedule.id == old.id))
    assert status == ScheduleStatus.superseded


@pytest.mark.anyio
async def test_the_newer_publication_wins_the_days_it_covers(
    client: AsyncClient, db: AsyncSession
) -> None:
    """The month stays visible, but the fortnight republished on top of it must
    be the version in force for its own days."""
    await _team(db)
    await create_published_schedule(
        db,
        starts_on=MONTH_START,
        days=30,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Ola Wiśniewska"],
        name="Cały miesiąc",
    )
    await login(client, "koord")
    republished = await _publish_second_half(client, db)
    new_by_slot = {
        (item["service_date"], item["role"]): item["assignee_name"]
        for item in republished["assignments"]
    }

    current = (await client.get("/api/v1/schedules/published")).json()
    served = {
        (item["service_date"], item["role"]): item["assignee_name"]
        for item in current["assignments"]
    }
    disagreements = {
        slot: (served.get(slot), expected)
        for slot, expected in new_by_slot.items()
        if slot in served and served[slot] != expected
    }
    assert disagreements == {}, f"stale assignments served for republished days: {disagreements}"


@pytest.mark.anyio
async def test_a_schedule_superseded_by_the_old_rule_still_shows(
    client: AsyncClient, db: AsyncSession
) -> None:
    """Existing databases already carry months wrongly retired by the previous
    rule; those days must resolve again rather than needing a migration."""
    await _team(db)
    damaged = await create_published_schedule(
        db,
        starts_on=MONTH_START,
        days=30,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Ola Wiśniewska"],
        name="Miesiąc zsuperseded'owany starą regułą",
    )
    damaged.status = ScheduleStatus.superseded
    await db.commit()

    await login(client, "koord")
    calendar = await client.get(
        "/api/v1/calendar",
        params={"starts_on": MONTH_START.isoformat(), "ends_on": MONTH_END.isoformat()},
    )
    covered = {
        item["service_date"] for item in calendar.json()["assignments"] if item["role"] == "primary"
    }
    assert len(covered) == 30, f"only {len(covered)} of 30 days resolved"
