"""The Undo of a painted availability range: one request that puts back what
the stroke replaced, with each entry's author and reason, and withdraws the
stroke's e-mails still waiting for the Undo window."""

import uuid
from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.clock import as_utc, business_today, utc_now
from oncall.domain.vocabulary import UserRole
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.availability_model import (
    Availability,
    AvailabilityRangeSnapshot,
)
from oncall.infrastructure.sqlalchemy.notification_models import NotificationOutbox
from oncall.notifications.service import UNDO_WINDOW
from tests.conftest import create_member, create_published_schedule, create_user, login
from tests.frozen_clock import FrozenClock

pytestmark = pytest.mark.usefixtures("frozen_clock")


async def _people(db: AsyncSession):
    beata_user = await create_user(db, "beata", display_name="Beata Lis", email="beata@example.com")
    beata = await create_member(db, beata_user, display_name="Beata Lis")
    coordinator = await create_user(
        db,
        "koord",
        role=UserRole.coordinator,
        display_name="Adam Nowicki",
        email="adam@example.com",
    )
    return beata_user, beata, coordinator


def _day(offset: int) -> str:
    return (business_today() + timedelta(days=offset)).isoformat()


async def _listed(client: AsyncClient, path: str) -> list[tuple]:
    response = await client.get(path)
    assert response.status_code == 200, response.text
    return [
        (
            entry["kind"],
            entry["starts_on"],
            entry["ends_on"],
            entry["note"],
            entry["created_by_name"],
        )
        for entry in response.json()
    ]


async def _paint(client: AsyncClient, path: str, undo_id: uuid.UUID | None, **body) -> None:
    response = await client.put(
        f"{path}/range", json={**body, "undo_id": str(undo_id) if undo_id else None}
    )
    assert response.status_code == 200, response.text


async def _outbox(db: AsyncSession, event: str) -> list[NotificationOutbox]:
    db.expire_all()
    return [
        row
        for row in (await db.scalars(select(NotificationOutbox))).all()
        if (row.context or {}).get("event") == event
    ]


async def test_undo_on_behalf_restores_the_members_own_entry_and_sends_nothing(
    client: AsyncClient, db: AsyncSession, frozen_clock: FrozenClock
) -> None:
    _, beata, _ = await _people(db)
    await login(client, "beata")
    await _paint(
        client,
        "/api/v1/availability/me",
        None,
        kind="prefer_not",
        starts_on=_day(5),
        ends_on=_day(9),
        note="szkolenie",
    )
    await login(client, "koord")
    member_path = f"/api/v1/availability/members/{beata.id}"
    undo_id = uuid.uuid4()
    await _paint(
        client, member_path, undo_id, kind="unavailable", starts_on=_day(6), ends_on=_day(7)
    )

    # The mail waits for the Undo window and names the stroke.
    [held] = await _outbox(db, "availability_created_on_behalf")
    assert held.context["undo_key"] == f"availability-range:{undo_id}"
    assert as_utc(held.send_after) == utc_now() + UNDO_WINDOW

    frozen_clock.advance(timedelta(seconds=5))
    undone = await client.post(f"{member_path}/range/undo/{undo_id}")

    assert undone.status_code == 204, undone.text
    # Beata's own entry is back on the stroke's days, still hers, still with
    # its reason; the days outside the stroke never changed.
    assert await _listed(client, member_path) == [
        ("prefer_not", _day(5), _day(5), "szkolenie", None),
        ("prefer_not", _day(6), _day(7), "szkolenie", None),
        ("prefer_not", _day(8), _day(9), "szkolenie", None),
    ]
    [cancelled] = await _outbox(db, "availability_created_on_behalf")
    assert cancelled.cancelled_at is not None
    restored = (
        await db.scalars(select(AuditEvent).where(AuditEvent.summary.contains("przywrócono")))
    ).all()
    assert [event.action for event in restored] == ["availability.created_on_behalf"]
    # Taken once: a second Undo has nothing left to put back.
    again = await client.post(f"{member_path}/range/undo/{undo_id}")
    assert again.status_code == 404
    assert await db.scalar(select(AvailabilityRangeSnapshot)) is None


async def test_undo_of_an_own_stroke_keeps_the_coordinators_entry_as_theirs(
    client: AsyncClient, db: AsyncSession
) -> None:
    _, beata, _ = await _people(db)
    await login(client, "koord")
    await _paint(
        client,
        f"/api/v1/availability/members/{beata.id}",
        None,
        kind="unavailable",
        starts_on=_day(3),
        ends_on=_day(3),
        note="urlop",
    )
    await login(client, "beata")
    undo_id = uuid.uuid4()
    await _paint(
        client, "/api/v1/availability/me", undo_id, kind=None, starts_on=_day(3), ends_on=_day(4)
    )
    assert await _listed(client, "/api/v1/availability/me") == []

    undone = await client.post(f"/api/v1/availability/me/range/undo/{undo_id}")

    assert undone.status_code == 204, undone.text
    assert await _listed(client, "/api/v1/availability/me") == [
        ("unavailable", _day(3), _day(3), "urlop", "Adam Nowicki"),
    ]


async def test_only_the_account_that_painted_can_undo(
    client: AsyncClient, db: AsyncSession
) -> None:
    beata_user, beata, _ = await _people(db)
    await create_user(db, "ewa", role=UserRole.coordinator, display_name="Ewa Zając")
    await login(client, "koord")
    undo_id = uuid.uuid4()
    member_path = f"/api/v1/availability/members/{beata.id}"
    await _paint(client, member_path, undo_id, kind="prefer", starts_on=_day(2), ends_on=_day(2))

    await login(client, "ewa")
    assert (await client.post(f"{member_path}/range/undo/{undo_id}")).status_code == 404
    await login(client, "beata")
    mine = await client.post(f"/api/v1/availability/me/range/undo/{undo_id}")
    assert mine.status_code == 404
    assert mine.json()["detail"] == "Tej zmiany nie można już cofnąć"
    assert [row.kind.value for row in (await db.scalars(select(Availability))).all()] == ["prefer"]


async def test_a_duty_conflict_mail_waits_and_a_repaint_after_the_undo_sends_it_again(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _people(db)
    await create_published_schedule(
        db, starts_on=business_today() + timedelta(days=1), days=3, primary=["Beata Lis"]
    )
    await login(client, "beata")
    undo_id = uuid.uuid4()
    stroke = {"kind": "unavailable", "starts_on": _day(2), "ends_on": _day(2)}
    await _paint(client, "/api/v1/availability/me", undo_id, **stroke)
    [held] = await _outbox(db, "availability_duty_conflict")
    assert as_utc(held.send_after) > utc_now()

    undone = await client.post(f"/api/v1/availability/me/range/undo/{undo_id}")
    assert undone.status_code == 204, undone.text
    await _paint(client, "/api/v1/availability/me", uuid.uuid4(), **stroke)

    conflicts = await _outbox(db, "availability_duty_conflict")
    assert [row.cancelled_at is None for row in conflicts] == [False, True]
