"""A duty covered by more than one schedule must count once.

After a partial republication two schedules legitimately cover the same day, so
summing every assignment from every published or superseded schedule counted
the overlapping duties twice.
"""

from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.clock import business_today
from oncall.domain.vocabulary import AssignmentRole, UserRole
from oncall.fairness_data import history_window, solver_history
from oncall.infrastructure.sqlalchemy.team_models import TeamMember
from oncall.workdays import polish_holidays
from tests.conftest import (
    create_member,
    create_published_schedule,
    create_user,
    generate_draft_directly,
    login,
)

START = business_today() - timedelta(days=20)


async def _team(db: AsyncSession) -> None:
    for username, name in (
        ("anna", "Anna Kowalska"),
        ("marek", "Marek Nowak"),
        ("ola", "Ola Wiśniewska"),
        ("piotr", "Piotr Zieliński"),
        ("ewa", "Ewa Mazur"),
    ):
        user = await create_user(db, username, display_name=name)
        await create_member(db, user, display_name=name)
    await create_user(db, "koord", role=UserRole.coordinator)


@pytest.mark.anyio
async def test_overlapping_schedules_do_not_double_count(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _team(db)
    await create_published_schedule(
        db,
        starts_on=START,
        days=10,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Ola Wiśniewska"],
        name="Pierwsza wersja",
    )
    # A second publication covering the same last five days, as a partial
    # republication produces.
    await create_published_schedule(
        db,
        starts_on=START + timedelta(days=5),
        days=5,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Ola Wiśniewska"],
        name="Druga wersja",
    )

    await login(client, "koord")
    report = (await client.get("/api/v1/fairness")).json()
    anna = next(m for m in report["members"] if m["display_name"] == "Anna Kowalska")

    # Ten days of primary duty, counted once each, whatever the day weight.
    duties = (
        await client.get("/api/v1/fairness/duties", params={"member_id": anna["member_id"]})
    ).json()
    primary_days = [d for d in duties if d["role"] == "primary"]
    assert len(primary_days) == 10
    assert len({d["service_date"] for d in primary_days}) == 10
    assert anna["primary"]["actual"] == sum(d["points"] for d in primary_days)


@pytest.mark.anyio
async def test_generator_history_counts_a_republished_duty_once(db: AsyncSession) -> None:
    """The generator used to sum raw rows, so a republished day became a debt.

    An inflated history makes the solver correct an imbalance nobody has, and it
    pushes that person out of the rotation for the whole next horizon.
    """
    await _team(db)
    await create_published_schedule(
        db,
        starts_on=START,
        days=10,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Ola Wiśniewska"],
        name="Pierwsza wersja",
    )
    await create_published_schedule(
        db,
        starts_on=START + timedelta(days=5),
        days=5,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Ola Wiśniewska"],
        name="Druga wersja",
    )
    members = (await db.scalars(select(TeamMember))).all()
    names_by_id = {member.id: member.display_name for member in members}

    history = await solver_history(
        db, *history_window(business_today() + timedelta(days=1)), names_by_id
    )

    holidays = polish_holidays(START, START + timedelta(days=9))
    days = [START + timedelta(days=offset) for offset in range(10)]
    expected = sum(2.0 if day.weekday() >= 5 or day in holidays else 1.0 for day in days)
    assert history.points[("Anna Kowalska", AssignmentRole.primary)] == expected
    # The 11-19 shift is counted per shift and only on working days.
    assert history.points[("Ola Wiśniewska", AssignmentRole.late_shift)] == sum(
        1 for day in days if day.weekday() < 5 and day not in holidays
    )
    assert history.lenses.get(("Marek Nowak", "weekends"), 0.0) == sum(
        1 for day in days if day.weekday() >= 5
    )


@pytest.mark.anyio
async def test_draft_forecast_counts_a_republished_duty_once(
    client: AsyncClient, db: AsyncSession
) -> None:
    """The forecast next to the draft matrix reads the same history as everything else."""
    await _team(db)
    await create_published_schedule(
        db,
        starts_on=START,
        days=10,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Ola Wiśniewska"],
        name="Pierwsza wersja",
    )
    await create_published_schedule(
        db,
        starts_on=START + timedelta(days=5),
        days=5,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Ola Wiśniewska"],
        name="Druga wersja",
    )
    await login(client, "koord")
    draft_start = business_today() + timedelta(days=1)
    draft = await generate_draft_directly(db, "koord", draft_start, draft_start + timedelta(days=6))

    impact = await client.get(f"/api/v1/scheduling/{draft['id']}/fairness-impact")
    assert impact.status_code == 200, impact.text
    anna = next(
        item
        for item in impact.json()["baseline_members"]
        if item["display_name"] == "Anna Kowalska"
    )

    holidays = polish_holidays(START, START + timedelta(days=9))
    days = [START + timedelta(days=offset) for offset in range(10)]
    assert anna["primary"]["actual"] == sum(
        2.0 if day.weekday() >= 5 or day in holidays else 1.0 for day in days
    )


@pytest.mark.anyio
async def test_draft_inside_published_range_does_not_inflate_the_forecast(
    client: AsyncClient, db: AsyncSession
) -> None:
    """A draft that only regenerates already-published days substitutes them,
    so the projected point sum matches the baseline rather than doubling the
    overlap (BLK6-02)."""
    await _team(db)
    published_start = business_today() + timedelta(days=1)
    await create_published_schedule(
        db,
        starts_on=published_start,
        days=14,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Ola Wiśniewska"],
        name="Opublikowany miesiąc",
    )
    await login(client, "koord")
    # Entirely inside the published range.
    draft = await generate_draft_directly(
        db, "koord", published_start + timedelta(days=2), published_start + timedelta(days=9)
    )

    impact = (await client.get(f"/api/v1/scheduling/{draft['id']}/fairness-impact")).json()
    baseline_primary = sum(m["primary"]["actual"] for m in impact["baseline_members"])
    projected_primary = sum(m["primary"]["actual"] for m in impact["projected_members"])
    assert projected_primary == pytest.approx(baseline_primary)
