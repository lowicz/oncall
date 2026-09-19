"""Coordinators file availability for a member who cannot reach the system (MED6-06).

The write path is shared with `/availability/me`, so these tests focus on what
is different on behalf of someone else: RBAC, the audit action, the member
notification, and the fact that the member can still undo the entry.
"""

from datetime import date, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.models import AuditEvent, Availability, NotificationOutbox, UserRole
from tests.conftest import create_member, create_user, login


async def _beata(db: AsyncSession):
    beata_user = await create_user(
        db, "beata.lis", display_name="Beata Lis", email="beata@example.com"
    )
    beata = await create_member(db, beata_user, display_name="Beata Lis")
    return beata_user, beata


async def test_coordinator_files_availability_on_behalf(client: AsyncClient, db: AsyncSession):
    _, beata = await _beata(db)
    await create_user(db, "adam.nowicki", role=UserRole.coordinator, display_name="Adam Nowicki")
    await login(client, "adam.nowicki")

    start = date.today() + timedelta(days=7)
    created = await client.post(
        f"/api/v1/availability/members/{beata.id}",
        json={
            "kind": "unavailable",
            "starts_on": str(start),
            "ends_on": str(start + timedelta(days=13)),
            "note": "urlop",
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["created_by_name"] == "Adam Nowicki"

    # Visible on the member's own screen, flagged as filed by someone else.
    await login(client, "beata.lis")
    mine = await client.get("/api/v1/availability/me")
    assert mine.status_code == 200
    assert [e["created_by_name"] for e in mine.json()] == ["Adam Nowicki"]

    # Audit distinguishes "I filed my holiday" from "a coordinator filed it".
    events = (
        await db.scalars(
            select(AuditEvent).where(AuditEvent.action == "availability.created_on_behalf")
        )
    ).all()
    assert len(events) == 1
    assert events[0].details["on_behalf_of"] == "Beata Lis"
    assert events[0].details["actor"] == "Adam Nowicki"

    # The member is told, through the outbox, that something was filed for them.
    outbox = [
        row
        for row in (await db.scalars(select(NotificationOutbox))).all()
        if (row.context or {}).get("event") == "availability_created_on_behalf"
    ]
    assert len(outbox) == 1
    assert outbox[0].recipient == "beata@example.com"

    # And the member can remove it themselves.
    removed = await client.delete(f"/api/v1/availability/me/{body['id']}")
    assert removed.status_code == 204
    assert (await db.scalar(select(Availability))) is None


async def test_member_cannot_file_on_behalf(client: AsyncClient, db: AsyncSession):
    _, beata = await _beata(db)
    other_user = await create_user(db, "carol", display_name="Carol Doe")
    await create_member(db, other_user, display_name="Carol Doe")
    await login(client, "carol")

    start = date.today() + timedelta(days=7)
    resp = await client.post(
        f"/api/v1/availability/members/{beata.id}",
        json={"kind": "unavailable", "starts_on": str(start), "ends_on": str(start)},
    )
    assert resp.status_code == 403
    assert (await client.get(f"/api/v1/availability/members/{beata.id}")).status_code == 403


async def test_unknown_member_is_404(client: AsyncClient, db: AsyncSession):
    await create_user(db, "adam.nowicki", role=UserRole.coordinator, display_name="Adam Nowicki")
    await login(client, "adam.nowicki")
    missing = "00000000-0000-0000-0000-000000000000"
    start = date.today() + timedelta(days=7)
    resp = await client.post(
        f"/api/v1/availability/members/{missing}",
        json={"kind": "unavailable", "starts_on": str(start), "ends_on": str(start)},
    )
    assert resp.status_code == 404


async def test_coordinator_filing_for_own_member_is_not_on_behalf(
    client: AsyncClient, db: AsyncSession
):
    """A coordinator who is also in the rotation files for themselves normally:
    plain audit action, no self-notification."""
    adam_user = await create_user(
        db,
        "adam.nowicki",
        role=UserRole.coordinator,
        display_name="Adam Nowicki",
        email="adam@example.com",
    )
    adam = await create_member(db, adam_user, display_name="Adam Nowicki")
    await login(client, "adam.nowicki")

    start = date.today() + timedelta(days=7)
    created = await client.post(
        f"/api/v1/availability/members/{adam.id}",
        json={"kind": "unavailable", "starts_on": str(start), "ends_on": str(start)},
    )
    assert created.status_code == 201, created.text
    assert created.json()["created_by_name"] is None

    audited = await db.scalars(select(AuditEvent).where(AuditEvent.action.like("availability.%")))
    actions = {event.action for event in audited}
    assert actions == {"availability.created"}
    assert (await db.scalar(select(NotificationOutbox))) is None
