"""A swap must work for a duty that lives in a republished range.

Once a shorter range is published inside a longer one, two schedules are
published at the same time and the client no longer knows which one owns a
given slot.
"""

from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.vocabulary import UserRole
from tests.conftest import create_member, create_published_schedule, create_user, login

MONTH_START = date.today()
MONTH_END = MONTH_START + timedelta(days=29)
SECOND_HALF_START = MONTH_START + timedelta(days=15)


async def _team(db: AsyncSession) -> None:
    for username, name in (
        ("anna", "Anna Kowalska"),
        ("marek", "Marek Nowak"),
        ("ola", "Ola Wiśniewska"),
        ("piotr", "Piotr Zieliński"),
    ):
        user = await create_user(db, username, display_name=name)
        await create_member(db, user, display_name=name)
    await create_user(db, "koord", role=UserRole.coordinator)


@pytest.mark.anyio
async def test_the_person_actually_on_duty_can_swap_the_republished_slot(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _team(db)
    month = await create_published_schedule(
        db,
        starts_on=MONTH_START,
        days=30,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Ola Wiśniewska"],
        name="Cały miesiąc",
    )
    # The republished half puts somebody else on primary, so the two schedules
    # disagree about who holds the slot and only the newer one counts. Marek
    # holds it every other day, so giving one away breaks no rest rule - a
    # continuous run would make every such swap a fresh violation (D3).
    await create_published_schedule(
        db,
        starts_on=SECOND_HALF_START,
        days=15,
        primary=["Marek Nowak", "Piotr Zieliński"],
        secondary=["Anna Kowalska"],
        late_shift=["Anna Kowalska"],
        name="Druga połowa",
    )
    target = SECOND_HALF_START

    await login(client, "marek")
    options = (
        await client.get(
            "/api/v1/swaps/options",
            params={"service_date": target.isoformat(), "role": "primary"},
        )
    ).json()
    assert options, "expected an eligible replacement"

    response = await client.post(
        "/api/v1/swaps",
        json={
            "schedule_id": str(month.id),
            "service_date": target.isoformat(),
            "role": "primary",
            "replacement_member_id": options[0]["member_id"],
        },
    )
    assert response.status_code == 201, response.text


@pytest.mark.anyio
async def test_someone_replaced_out_of_a_slot_cannot_swap_it(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _team(db)
    month = await create_published_schedule(
        db,
        starts_on=MONTH_START,
        days=30,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Ola Wiśniewska"],
        name="Cały miesiąc",
    )
    await create_published_schedule(
        db,
        starts_on=SECOND_HALF_START,
        days=15,
        primary=["Marek Nowak"],
        secondary=["Anna Kowalska"],
        late_shift=["Ola Wiśniewska"],
        name="Druga połowa",
    )
    target = SECOND_HALF_START + timedelta(days=2)

    # Anna is primary that day only in the stale schedule.
    await login(client, "anna")
    ola = next(
        m
        for m in (await client.get("/api/v1/team")).json()
        if m["display_name"] == "Ola Wiśniewska"
    )
    response = await client.post(
        "/api/v1/swaps",
        json={
            "schedule_id": str(month.id),
            "service_date": target.isoformat(),
            "role": "primary",
            "replacement_member_id": ola["id"],
        },
    )
    assert response.status_code == 409
