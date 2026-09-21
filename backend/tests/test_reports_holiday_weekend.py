import csv
import io
from datetime import date

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.vocabulary import UserRole
from tests.conftest import create_member, create_published_schedule, create_user, login


@pytest.mark.anyio
async def test_holiday_on_weekend_counts_as_weekend_with_points(
    client: AsyncClient, db: AsyncSession
) -> None:
    """2026-08-15 (Wniebowzięcie NMP) is a Saturday: decision D4 counts it as a
    weekend everywhere, same as the scheduler and the fairness report, not as a
    separate holiday column."""
    anna_user = await create_user(db, "anna", display_name="Anna Kowalska")
    await create_member(db, anna_user, display_name="Anna Kowalska")
    await create_user(db, "koord", role=UserRole.coordinator)
    await create_published_schedule(
        db,
        starts_on=date(2026, 8, 14),
        days=3,
        primary=["Anna Kowalska"],
        secondary=["Anna Kowalska"],
        late_shift=["Anna Kowalska"],
    )

    await login(client, "koord")
    response = await client.get("/api/v1/reports/monthly", params={"month": "2026-08"})
    assert response.status_code == 200, response.text
    row = next(r for r in response.json()["rows"] if r["name"] == "Anna Kowalska")

    assert row["primary_workdays"] == 1
    assert row["primary_weekends"] == 2
    assert row["primary_holidays"] == 0
    assert row["secondary_workdays"] == 1
    assert row["secondary_weekends"] == 2
    assert row["secondary_holidays"] == 0
    assert row["late_shifts"] == 1
    assert row["primary_points"] == 5.0
    assert row["secondary_points"] == 5.0
    assert row["total_points"] == 10.0


@pytest.mark.anyio
async def test_monthly_csv_has_points_columns_matching_preview(
    client: AsyncClient, db: AsyncSession
) -> None:
    anna_user = await create_user(db, "anna", display_name="Anna Kowalska")
    await create_member(db, anna_user, display_name="Anna Kowalska")
    await create_user(db, "koord", role=UserRole.coordinator)
    await create_published_schedule(
        db,
        starts_on=date(2026, 8, 14),
        days=3,
        primary=["Anna Kowalska"],
        secondary=["Anna Kowalska"],
        late_shift=["Anna Kowalska"],
    )

    await login(client, "koord")
    response = await client.get("/api/v1/reports/monthly.csv", params={"month": "2026-08"})
    assert response.status_code == 200, response.text
    rows = list(csv.reader(io.StringIO(response.text)))
    header, data_row = rows[0], next(r for r in rows[1:] if r[1] == "Anna Kowalska")

    assert header[-3:] == ["primary_punkty", "secondary_punkty", "punkty_razem"]
    assert data_row[-3:] == ["5.0", "5.0", "10.0"]
