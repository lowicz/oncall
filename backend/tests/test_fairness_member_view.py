from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.vocabulary import UserRole
from tests.conftest import create_member, create_published_schedule, create_user, login


@pytest.mark.anyio
async def test_member_balance_matches_their_row_in_the_team_report(
    client: AsyncClient, db: AsyncSession
) -> None:
    anna_user = await create_user(db, "anna", display_name="Anna Kowalska")
    marek_user = await create_user(db, "marek", display_name="Marek Nowak")
    anna = await create_member(db, anna_user, display_name="Anna Kowalska")
    await create_member(db, marek_user, display_name="Marek Nowak")
    await create_user(db, "koord", role=UserRole.coordinator)
    today = date.today()
    await create_published_schedule(
        db,
        starts_on=today - timedelta(days=6),
        days=7,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Marek Nowak"],
    )

    await login(client, "koord")
    team_report = (await client.get("/api/v1/fairness")).json()
    team_row = next(row for row in team_report["members"] if row["member_id"] == str(anna.id))

    member_client = client.__class__(transport=client._transport, base_url="http://test")
    await login(member_client, "anna")
    response = await member_client.get("/api/v1/fairness")
    assert response.status_code == 200, response.text
    member_report = response.json()

    assert member_report["members"] == [team_row]
    for lens in ("primary", "secondary", "late_shift", "weekends", "holidays"):
        assert member_report["members"][0][lens]["expected"] == team_row[lens]["expected"]
        assert member_report["members"][0][lens]["deviation"] == team_row[lens]["deviation"]
    assert member_report["spreads"] == []
    assert member_report["totals"] == {
        "primary_points": team_row["primary"]["actual"],
        "secondary_points": team_row["secondary"]["actual"],
        "late_shift_count": team_row["late_shift"]["actual"],
        "weekend_duties": team_row["weekends"]["actual"],
        "holiday_duties": team_row["holidays"]["actual"],
    }
