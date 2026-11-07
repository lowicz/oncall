"""Atomic range replacement for the availability calendar."""

from datetime import UTC, date, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.vocabulary import UserRole
from oncall.infrastructure.sqlalchemy.availability import SqlAlchemyAvailability
from oncall.infrastructure.sqlalchemy.availability_model import Availability
from tests.conftest import create_member, create_user, login
from tests.frozen_clock import FrozenClock

START = date(2026, 9, 20)


async def _member(client: AsyncClient, db: AsyncSession, *, role: UserRole = UserRole.member):
    user = await create_user(db, "anna", role=role, display_name="Anna Nowak")
    member = await create_member(db, user, display_name="Anna Nowak")
    await login(client, "anna")
    return member


async def _create(client: AsyncClient, *, starts_on: date, ends_on: date) -> dict:
    response = await client.post(
        "/api/v1/availability/me",
        json={
            "kind": "unavailable",
            "starts_on": starts_on.isoformat(),
            "ends_on": ends_on.isoformat(),
            "note": "wyjazd",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.mark.usefixtures("frozen_clock")
async def test_range_replacement_cuts_an_entry_and_paints_in_one_request(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _member(client, db)
    await _create(client, starts_on=START, ends_on=date(2026, 9, 24))

    response = await client.put(
        "/api/v1/availability/me/range",
        json={
            "kind": "prefer_not",
            "starts_on": "2026-09-22",
            "ends_on": "2026-09-23",
            "note": "szkolenie",
        },
    )

    assert response.status_code == 200, response.text
    assert response.json()["kind"] == "prefer_not"
    listed = await client.get("/api/v1/availability/me")
    assert [
        (entry["kind"], entry["starts_on"], entry["ends_on"], entry["note"])
        for entry in listed.json()
    ] == [
        ("unavailable", "2026-09-20", "2026-09-21", "wyjazd"),
        ("prefer_not", "2026-09-22", "2026-09-23", "szkolenie"),
        ("unavailable", "2026-09-24", "2026-09-24", "wyjazd"),
    ]


@pytest.mark.usefixtures("frozen_clock")
async def test_range_can_be_cleared_on_behalf_of_a_member(
    client: AsyncClient, db: AsyncSession
) -> None:
    member_user = await create_user(db, "beata", display_name="Beata Lis")
    member = await create_member(db, member_user, display_name="Beata Lis")
    await create_user(db, "koord", role=UserRole.coordinator, display_name="Koordynator Nowak")
    await login(client, "beata")
    await _create(client, starts_on=START, ends_on=date(2026, 9, 21))
    await login(client, "koord")

    response = await client.put(
        f"/api/v1/availability/members/{member.id}/range",
        json={
            "kind": None,
            "starts_on": "2026-09-20",
            "ends_on": "2026-09-20",
        },
    )

    assert response.status_code == 200, response.text
    assert response.json() is None
    listed = await client.get(f"/api/v1/availability/members/{member.id}")
    assert [
        (entry["kind"], entry["starts_on"], entry["ends_on"], entry["created_by_name"])
        for entry in listed.json()
    ] == [("unavailable", "2026-09-21", "2026-09-21", None)]


@pytest.mark.usefixtures("frozen_clock")
async def test_failure_in_the_middle_rolls_back_the_whole_range_on_sqlite(
    client: AsyncClient,
    db: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    member = await _member(client, db)
    original = await _create(client, starts_on=START, ends_on=date(2026, 9, 24))
    record = SqlAlchemyAvailability.record
    calls = 0

    async def fail_on_second_record(self, entry):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise RuntimeError("injected range failure")
        await record(self, entry)

    monkeypatch.setattr(SqlAlchemyAvailability, "record", fail_on_second_record)

    with pytest.raises(RuntimeError, match="injected range failure"):
        await client.put(
            "/api/v1/availability/me/range",
            json={
                "kind": "prefer_not",
                "starts_on": "2026-09-22",
                "ends_on": "2026-09-22",
            },
        )

    rows = (
        await db.scalars(
            select(Availability)
            .where(Availability.member_id == member.id)
            .order_by(Availability.starts_on)
        )
    ).all()
    stored = [(str(row.id), row.kind.value, row.starts_on, row.ends_on, row.note) for row in rows]
    assert stored == [(original["id"], "unavailable", START, date(2026, 9, 24), "wyjazd")]


async def test_range_replacement_keeps_the_elapsed_part_of_an_entry(
    client: AsyncClient, db: AsyncSession, frozen_clock: FrozenClock
) -> None:
    await _member(client, db)
    await _create(client, starts_on=date(2026, 10, 1), ends_on=date(2026, 11, 30))
    frozen_clock.instant = datetime(2026, 11, 7, 10, 0, tzinfo=UTC)
    await login(client, "anna")

    response = await client.put(
        "/api/v1/availability/me/range",
        json={"kind": "prefer", "starts_on": "2026-11-07", "ends_on": "2026-11-07"},
    )

    assert response.status_code == 200, response.text
    listed = await client.get("/api/v1/availability/me")
    assert [
        (entry["kind"], entry["starts_on"], entry["ends_on"], entry["note"])
        for entry in listed.json()
    ] == [
        ("unavailable", "2026-10-01", "2026-11-06", "wyjazd"),
        ("prefer", "2026-11-07", "2026-11-07", None),
        ("unavailable", "2026-11-08", "2026-11-30", "wyjazd"),
    ]
