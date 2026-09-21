"""D1: `late_shift_balanced` tells the UI whether the 11-19 column means a
lens balanced on its own (anchor `independent`) or a count that follows the
anchor role. The per-member numbers stay filled either way."""

from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.vocabulary import UserRole
from tests.conftest import create_member, create_user, generate_draft_directly, login


async def _team(db: AsyncSession) -> None:
    for username, name in (
        ("anna", "Anna Kowalska"),
        ("marek", "Marek Nowak"),
        ("ola", "Ola Wiśniewska"),
    ):
        user = await create_user(db, username, display_name=name)
        await create_member(db, user, display_name=name)
    await create_user(db, "koord", role=UserRole.coordinator)


async def _set_anchor(client: AsyncClient, anchor: str) -> None:
    response = await client.put(
        "/api/v1/scheduling/policy",
        json={"rotation_mode": "hybrid", "late_shift_anchor": anchor},
    )
    assert response.status_code == 200, response.text


@pytest.mark.anyio
@pytest.mark.parametrize(("anchor", "expected"), [("secondary", False), ("independent", True)])
async def test_fairness_report_carries_the_late_shift_balanced_flag(
    client: AsyncClient, db: AsyncSession, anchor: str, expected: bool
) -> None:
    await _team(db)
    await login(client, "koord")
    await _set_anchor(client, anchor)

    report = await client.get("/api/v1/fairness")

    assert report.status_code == 200, report.text
    assert report.json()["late_shift_balanced"] is expected
    for member in report.json()["members"]:
        assert "late_shift" in member


@pytest.mark.anyio
@pytest.mark.parametrize(("anchor", "expected"), [("secondary", False), ("independent", True)])
async def test_draft_impact_carries_the_late_shift_balanced_flag(
    client: AsyncClient, db: AsyncSession, anchor: str, expected: bool
) -> None:
    await _team(db)
    await login(client, "koord")
    await _set_anchor(client, anchor)
    draft_start = date.today() + timedelta(days=1)
    draft = await generate_draft_directly(db, "koord", draft_start, draft_start + timedelta(days=6))

    impact = await client.get(f"/api/v1/scheduling/{draft['id']}/fairness-impact")

    assert impact.status_code == 200, impact.text
    assert impact.json()["late_shift_balanced"] is expected
    for member in impact.json()["projected_members"]:
        assert "late_shift" in member
