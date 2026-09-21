from datetime import date, timedelta

from sqlalchemy import select

from oncall.domain.vocabulary import UserRole
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from tests.conftest import create_user, login

TODAY = date.today()


async def _create_event(client, **overrides):
    payload = {
        "starts_on": str(TODAY),
        "ends_on": str(TODAY + timedelta(days=2)),
        "title": "Ćwiczenia awaryjne",
        "color": "amber",
    }
    payload.update(overrides)
    return await client.post("/api/v1/calendar/events", json=payload)


async def test_coordinator_manages_visual_events_and_audit(client, db) -> None:
    await create_user(db, "koord", role=UserRole.coordinator)
    await login(client, "koord")

    created = await _create_event(client)
    assert created.status_code == 201, created.text
    event = created.json()

    calendar = await client.get(
        "/api/v1/calendar",
        params={"starts_on": str(TODAY), "ends_on": str(TODAY + timedelta(days=3))},
    )
    assert calendar.status_code == 200, calendar.text
    days = calendar.json()["days"]
    assert [len(day["events"]) for day in days] == [1, 1, 1, 0]
    assert days[0]["events"][0] == {
        "id": event["id"],
        "title": "Ćwiczenia awaryjne",
        "color": "amber",
    }

    updated = await client.patch(
        f"/api/v1/calendar/events/{event['id']}",
        json={"ends_on": str(TODAY + timedelta(days=1)), "title": "Test DR", "color": "red"},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["title"] == "Test DR"
    assert updated.json()["color"] == "red"

    deleted = await client.delete(f"/api/v1/calendar/events/{event['id']}")
    assert deleted.status_code == 204
    actions = set(await db.scalars(select(AuditEvent.action)))
    assert {
        "calendar.event_created",
        "calendar.event_updated",
        "calendar.event_deleted",
    } <= actions


async def test_viewer_can_read_but_cannot_write_events(client, db) -> None:
    await create_user(db, "koord", role=UserRole.coordinator)
    await create_user(db, "viewer", role=UserRole.viewer)
    await login(client, "koord")
    created = await _create_event(client)
    assert created.status_code == 201

    await login(client, "viewer")
    listed = await client.get(
        "/api/v1/calendar/events",
        params={"starts_on": str(TODAY), "ends_on": str(TODAY + timedelta(days=3))},
    )
    assert listed.status_code == 200
    assert [item["title"] for item in listed.json()] == ["Ćwiczenia awaryjne"]
    assert (await _create_event(client, title="Niedozwolone")).status_code == 403


async def test_share_link_sees_only_events_overlapping_its_range(client, db) -> None:
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    assert (await _create_event(client, title="W zakresie")).status_code == 201
    assert (
        await _create_event(
            client,
            starts_on=str(TODAY + timedelta(days=10)),
            ends_on=str(TODAY + timedelta(days=10)),
            title="Poza zakresem",
        )
    ).status_code == 201
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

    guest = client.__class__(transport=client._transport, base_url="http://test")
    assert (await guest.post("/api/v1/share/exchange", json={"token": token})).status_code == 200
    listed = await guest.get(
        "/api/v1/calendar/events",
        params={
            "starts_on": str(TODAY - timedelta(days=20)),
            "ends_on": str(TODAY + timedelta(days=20)),
        },
    )
    assert listed.status_code == 200, listed.text
    assert [item["title"] for item in listed.json()] == ["W zakresie"]
