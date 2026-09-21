"""The 11-19 shift exists only on Polish working days, on every read path.

The generator stopped producing weekend and holiday 11-19 shifts, but schedules
built before that rule still carry those rows, and per-slot resolution handed
them the Saturday slot that a compliant schedule simply leaves empty. Refusing
to resolve the slot is what makes the rule hold for the calendar, the fairness
report, the monthly report, the ICS feeds and "who is on duty now" at once.
"""

from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.vocabulary import AssignmentRole, UserRole
from oncall.effective import effective_assignments
from oncall.workdays import polish_holidays
from tests.conftest import create_member, create_published_schedule, create_user, login

# A fortnight that certainly contains two weekends.
START = date.today() - timedelta(days=20)
END = START + timedelta(days=13)


async def _team(db: AsyncSession) -> None:
    for username, name in (
        ("anna", "Anna Kowalska"),
        ("marek", "Marek Nowak"),
        ("ola", "Ola Wiśniewska"),
    ):
        user = await create_user(db, username, display_name=name)
        await create_member(db, user, display_name=name)
    await create_user(db, "koord", role=UserRole.coordinator)


async def _legacy_schedule(db: AsyncSession) -> None:
    """A publication from before the rule: an 11-19 shift on every single day."""
    await create_published_schedule(
        db,
        starts_on=START,
        days=14,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Ola Wiśniewska"],
        name="Sprzed reguły",
    )


@pytest.mark.anyio
async def test_day_off_late_shift_is_never_resolved(db: AsyncSession) -> None:
    await _team(db)
    await _legacy_schedule(db)
    holidays = polish_holidays(START, END)

    resolved = await effective_assignments(db, START, END)

    late_days = [day for (day, role) in resolved if role == AssignmentRole.late_shift]
    assert late_days, "the fixture has to produce some working-day shifts"
    assert not [day for day in late_days if day.weekday() >= 5 or day in holidays]


@pytest.mark.anyio
async def test_calendar_hides_the_day_off_late_shift(client: AsyncClient, db: AsyncSession) -> None:
    await _team(db)
    await _legacy_schedule(db)
    await login(client, "koord")

    calendar = await client.get(
        "/api/v1/calendar",
        params={"starts_on": START.isoformat(), "ends_on": END.isoformat()},
    )
    assert calendar.status_code == 200, calendar.text
    payload = calendar.json()

    days_off = {day["service_date"] for day in payload["days"] if day["is_day_off"]}
    assert days_off, "a fortnight always contains weekends"
    assert not [
        item
        for item in payload["assignments"]
        if item["role"] == "late_shift" and item["service_date"] in days_off
    ]
