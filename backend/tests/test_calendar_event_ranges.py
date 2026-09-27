"""The calendar refuses ranges it cannot serve and events that do not exist."""

import uuid
from datetime import date, timedelta

from httpx import AsyncClient
from sqlalchemy import func, select

from oncall.domain.vocabulary import UserRole
from oncall.i18n import translate
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from tests.conftest import create_user, login

TODAY = date.today()


async def _event(client: AsyncClient) -> dict:
    created = await client.post(
        "/api/v1/calendar/events",
        json={
            "starts_on": str(TODAY),
            "ends_on": str(TODAY + timedelta(days=2)),
            "title": "Przegląd",
            "color": "amber",
        },
    )
    assert created.status_code == 201, created.text
    return created.json()


async def test_events_are_listed_only_for_a_forward_range_of_at_most_90_days(client, db) -> None:
    await create_user(db, "koord", role=UserRole.coordinator)
    await login(client, "koord")

    reversed_range = await client.get(
        "/api/v1/calendar/events",
        params={"starts_on": str(TODAY), "ends_on": str(TODAY - timedelta(days=1))},
    )
    too_long = await client.get(
        "/api/v1/calendar/events",
        params={"starts_on": str(TODAY), "ends_on": str(TODAY + timedelta(days=90))},
    )
    longest = await client.get(
        "/api/v1/calendar/events",
        params={"starts_on": str(TODAY), "ends_on": str(TODAY + timedelta(days=89))},
    )

    assert reversed_range.status_code == 422
    assert reversed_range.json()["detail"] == translate("calendar.range_ends_before_start")
    assert too_long.status_code == 422
    assert too_long.json()["detail"] == translate("calendar.event_range_too_long")
    assert longest.status_code == 200
    assert longest.json() == []


async def test_the_matrix_refuses_a_reversed_or_overlong_range(client, db) -> None:
    await create_user(db, "koord", role=UserRole.coordinator)
    await login(client, "koord")

    for ends_on in (TODAY - timedelta(days=1), TODAY + timedelta(days=90)):
        response = await client.get(
            "/api/v1/calendar", params={"starts_on": str(TODAY), "ends_on": str(ends_on)}
        )
        assert response.status_code == 422
        assert response.json()["detail"] == translate("calendar.range_invalid")


async def test_a_share_link_reading_events_outside_its_range_is_refused(client, db) -> None:
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    link = await client.post(
        "/api/v1/admin/share-links",
        json={
            "label": "Gość",
            "starts_on": str(TODAY),
            "ends_on": str(TODAY + timedelta(days=3)),
            "expires_days": 7,
        },
    )
    assert link.status_code == 201, link.text
    token = link.json()["url"].rsplit("/share/", 1)[1]
    guest = AsyncClient(transport=client._transport, base_url="http://test")
    assert (await guest.post("/api/v1/share/exchange", json={"token": token})).status_code == 200

    response = await guest.get(
        "/api/v1/calendar/events",
        params={
            "starts_on": str(TODAY + timedelta(days=10)),
            "ends_on": str(TODAY + timedelta(days=20)),
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == translate("calendar.range_ends_before_start")


async def test_an_event_cannot_be_moved_to_end_before_it_starts(client, db) -> None:
    await create_user(db, "koord", role=UserRole.coordinator)
    await login(client, "koord")
    event = await _event(client)

    response = await client.patch(
        f"/api/v1/calendar/events/{event['id']}",
        json={"ends_on": str(TODAY - timedelta(days=1))},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == translate("calendar.range_ends_before_start")
    unchanged = await client.get(
        "/api/v1/calendar/events",
        params={"starts_on": str(TODAY), "ends_on": str(TODAY + timedelta(days=3))},
    )
    assert [item["ends_on"] for item in unchanged.json()] == [str(TODAY + timedelta(days=2))]
    updates = await db.scalar(
        select(func.count())
        .select_from(AuditEvent)
        .where(AuditEvent.action == "calendar.event_updated")
    )
    assert updates == 0


async def test_a_missing_event_can_be_neither_changed_nor_deleted(client, db) -> None:
    await create_user(db, "koord", role=UserRole.coordinator)
    await login(client, "koord")
    missing = uuid.uuid4()

    changed = await client.patch(f"/api/v1/calendar/events/{missing}", json={"title": "Nowy"})
    deleted = await client.delete(f"/api/v1/calendar/events/{missing}")

    for response in (changed, deleted):
        assert response.status_code == 404
        assert response.json()["detail"] == translate("calendar.event_not_found")
