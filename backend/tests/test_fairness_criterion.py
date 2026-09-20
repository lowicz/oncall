"""D2/Z6: both fairness surfaces carry the acceptance criterion with the
per-lens spreads it judges, computed backend-side so the threshold lives in
one place with archive/docs/PLAN.md par. 3."""

from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.models import UserRole
from tests.conftest import create_member, create_user, generate_draft_directly, login

GRADED_WHEN_ANCHORED = ["primary", "secondary", "weekends", "holidays"]


async def _team(db: AsyncSession) -> None:
    for username, name in (
        ("anna", "Anna Kowalska"),
        ("marek", "Marek Nowak"),
        ("ola", "Ola Wiśniewska"),
    ):
        user = await create_user(db, username, display_name=name)
        await create_member(db, user, display_name=name)
    await create_user(db, "koord", role=UserRole.coordinator)


def _check_spreads(spreads: list[dict], lenses: list[str], points: int) -> None:
    assert [item["lens"] for item in spreads] == lenses
    for item in spreads:
        assert item["meets_criterion"] == (item["spread"] <= points)


@pytest.mark.anyio
async def test_report_carries_the_criterion_and_graded_spreads(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _team(db)
    await login(client, "koord")

    report = (await client.get("/api/v1/fairness")).json()

    assert report["criterion_points"] == 3
    _check_spreads(report["spreads"], GRADED_WHEN_ANCHORED, 3)
    assert report["criterion_met"] == all(item["meets_criterion"] for item in report["spreads"])


@pytest.mark.anyio
async def test_report_covers_late_shift_only_when_independent(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _team(db)
    await login(client, "koord")
    updated = await client.put(
        "/api/v1/scheduling/policy",
        json={"rotation_mode": "hybrid", "late_shift_anchor": "independent"},
    )
    assert updated.status_code == 200, updated.text

    report = (await client.get("/api/v1/fairness")).json()

    _check_spreads(
        report["spreads"], ["primary", "secondary", "late_shift", "weekends", "holidays"], 3
    )


@pytest.mark.anyio
async def test_departed_member_is_visible_but_excluded_from_criterion(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _team(db)
    departed = await create_user(db, "robert", display_name="Robert Baran")
    departed_member = await create_member(db, departed, display_name="Robert Baran")
    as_of = date.today() + timedelta(days=30)
    departed_member.active_until = as_of - timedelta(days=1)
    await db.commit()
    await login(client, "koord")

    report = (await client.get(f"/api/v1/fairness?as_of={as_of.isoformat()}")).json()

    robert = next(item for item in report["members"] if item["display_name"] == "Robert Baran")
    assert robert["in_criterion"] is False
    assert all(
        outlier[side]["display_name"] != "Robert Baran"
        for outlier in report["outliers"]
        for side in ("highest", "lowest")
        if outlier[side] is not None
    )


@pytest.mark.anyio
async def test_impact_carries_spreads_before_after_and_no_floor_when_criterion_holds(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _team(db)
    await login(client, "koord")
    draft_start = date.today() + timedelta(days=1)
    draft = await generate_draft_directly(db, "koord", draft_start, draft_start + timedelta(days=6))

    impact = (await client.get(f"/api/v1/scheduling/{draft['id']}/fairness-impact")).json()

    assert impact["criterion_points"] == 3
    assert [item["lens"] for item in impact["spreads"]] == GRADED_WHEN_ANCHORED
    for item in impact["spreads"]:
        assert item["meets_criterion"] == (item["after"] <= 3)
    assert impact["criterion_met"] == all(item["meets_criterion"] for item in impact["spreads"])
    assert impact["acceptance_floor"] is None
