"""The coordinator's approval of a swap as a policy switch.

On (the default) nothing changes: the replacement's acceptance sends the
request to a coordinator. Off, that acceptance alone writes the swap into the
schedule, and coordinators are told about it without being asked for anything.
"""

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.clock import business_today
from oncall.domain.vocabulary import UserRole
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.notification_models import NotificationOutbox
from tests.conftest import create_member, create_published_schedule, create_user, login

POLICY = "/api/v1/scheduling/policy"
SWAP_POLICY = "/api/v1/swaps/policy"


async def _team(db: AsyncSession) -> dict:
    """Anna holds primary all week; Marek, Ola and Ewa can take it. The
    coordinator has an address, so the coordinators' copies are observable."""
    members = {}
    for username, name in (
        ("anna", "Anna Kowalska"),
        ("marek", "Marek Nowak"),
        ("ola", "Ola Wiśniewska"),
        ("ewa", "Ewa Lis"),
    ):
        user = await create_user(db, username, email=f"{username}@example.com", display_name=name)
        members[name] = await create_member(db, user, display_name=name)
    await create_user(
        db,
        "koord",
        role=UserRole.coordinator,
        email="koord@example.com",
        display_name="Jan Koordynator",
    )
    return members


async def _roster(db: AsyncSession):
    """Anna's whole week; the swapped day is today, so no rest rule is
    disturbed by taking a day out of the middle of her run."""
    return await create_published_schedule(
        db,
        starts_on=business_today(),
        days=7,
        primary=["Anna Kowalska"],
        secondary=["Ola Wiśniewska"],
        late_shift=["Ola Wiśniewska"],
    )


async def _set_approval(client: AsyncClient, required: bool) -> None:
    await login(client, "koord")
    saved = await client.put(
        POLICY, json={"rotation_mode": "hybrid", "coordinator_swap_approval_required": required}
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["coordinator_swap_approval_required"] is required


async def _request_swap(client: AsyncClient, schedule, members: dict, *, day=None) -> str:
    await login(client, "anna")
    created = await client.post(
        "/api/v1/swaps",
        json={
            "schedule_id": str(schedule.id),
            "service_date": str(day or business_today()),
            "role": "primary",
            "replacement_member_id": str(members["Marek Nowak"].id),
        },
    )
    assert created.status_code == 201, created.text
    return created.json()["id"]


async def _outbox(db: AsyncSession) -> list[NotificationOutbox]:
    return list((await db.scalars(select(NotificationOutbox))).all())


async def _audit_actions(db: AsyncSession) -> list[str]:
    events = (await db.scalars(select(AuditEvent).order_by(AuditEvent.occurred_at))).all()
    return [event.action for event in events]


async def test_the_policy_defaults_to_approval_and_round_trips_the_switch(client, db) -> None:
    await create_user(db, "koord", role=UserRole.coordinator)
    await login(client, "koord")

    current = await client.get(POLICY)
    assert current.status_code == 200, current.text
    assert current.json()["coordinator_swap_approval_required"] is True

    saved = await client.put(
        POLICY, json={"rotation_mode": "hybrid", "coordinator_swap_approval_required": False}
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["coordinator_swap_approval_required"] is False
    assert (await client.get(POLICY)).json()["coordinator_swap_approval_required"] is False

    # Left out of a later change, the switch keeps its value like the other
    # optional fields do.
    kept = await client.put(POLICY, json={"rotation_mode": "daily", "solve_seconds": 20})
    assert kept.status_code == 200, kept.text
    assert kept.json()["coordinator_swap_approval_required"] is False

    changes = select(AuditEvent).where(AuditEvent.action == "policy.updated")
    first = (await db.scalars(changes.order_by(AuditEvent.occurred_at))).first()
    assert first is not None
    assert first.details["coordinator_swap_approval_required"] is False
    assert "bez zatwierdzenia koordynatora" in first.summary


async def test_every_member_reads_the_swap_policy(client, db) -> None:
    """The swap screens of members word the next step from it, so it is not
    behind the coordinator-only policy endpoint."""
    await _team(db)
    await login(client, "marek")
    assert (await client.get(POLICY)).status_code == 403

    read = await client.get(SWAP_POLICY)
    assert read.status_code == 200, read.text
    assert read.json() == {"coordinator_approval_required": True}

    await _set_approval(client, False)
    await login(client, "marek")
    assert (await client.get(SWAP_POLICY)).json() == {"coordinator_approval_required": False}


async def test_by_default_the_acceptance_still_waits_for_a_coordinator(client, db) -> None:
    members = await _team(db)
    schedule = await _roster(db)
    swap_id = await _request_swap(client, schedule, members)

    await login(client, "marek")
    accepted = await client.post(f"/api/v1/swaps/{swap_id}/accept")
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "pending_coordinator"

    published = (await client.get("/api/v1/schedules/published")).json()
    assert published["version"] == schedule.version
    to_coordinator = [row for row in await _outbox(db) if row.recipient == "koord@example.com"]
    assert len(to_coordinator) == 1
    assert to_coordinator[0].subject.startswith("Do zatwierdzenia:")
    assert "swap.approved" not in await _audit_actions(db)


async def test_without_approval_the_acceptance_writes_the_swap_into_the_schedule(
    client, db
) -> None:
    members = await _team(db)
    schedule = await _roster(db)
    await _set_approval(client, False)
    day = business_today()
    swap_id = await _request_swap(client, schedule, members, day=day)

    await login(client, "marek")
    accepted = await client.post(f"/api/v1/swaps/{swap_id}/accept")
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["status"] == "approved"

    # The roster is what changed, not only the request's status.
    published = (await client.get("/api/v1/schedules/published")).json()
    assert published["version"] == schedule.version + 1
    slot = next(
        item
        for item in published["assignments"]
        if item["service_date"] == str(day) and item["role"] == "primary"
    )
    assert slot["assignee_name"] == "Marek Nowak"
    listed = (await client.get("/api/v1/swaps")).json()
    assert [item["status"] for item in listed] == ["approved"]

    # Nothing ever waited for a coordinator, and nothing is left for one.
    actions = await _audit_actions(db)
    assert "swap.approved" in actions
    assert "swap.accepted" not in actions
    await login(client, "koord")
    approve = await client.post(f"/api/v1/swaps/{swap_id}/approve")
    assert approve.status_code == 409, approve.text
    assert (await client.get("/api/v1/swaps")).json()[0]["status"] == "approved"


async def test_without_approval_coordinators_are_told_but_not_asked(client, db) -> None:
    members = await _team(db)
    schedule = await _roster(db)
    await _set_approval(client, False)
    swap_id = await _request_swap(client, schedule, members)

    await login(client, "marek")
    assert (await client.post(f"/api/v1/swaps/{swap_id}/accept")).status_code == 200

    rows = await _outbox(db)
    by_recipient = {row.recipient: row for row in rows if "wpisana do grafiku" in row.subject}
    assert set(by_recipient) == {"anna@example.com", "marek@example.com", "koord@example.com"}
    for party in ("anna@example.com", "marek@example.com"):
        assert by_recipient[party].subject.startswith("Zamiana wpisana do grafiku:")
        assert "nie wymaga zatwierdzenia koordynatora" in by_recipient[party].body
    fyi = by_recipient["koord@example.com"]
    assert fyi.subject.startswith("Do wiadomości:")
    assert "tylko informacyjna" in fyi.body
    assert fyi.context["event"] == "swap_recorded_fyi"
    assert not any(row.subject.startswith("Do zatwierdzenia:") for row in rows)
    assert not any("zatwierdzona" in row.subject for row in rows)


async def test_without_approval_a_slot_that_changed_owner_cancels_the_request(client, db) -> None:
    """The acceptance runs the deciding checks an approval runs."""
    members = await _team(db)
    schedule = await _roster(db)
    await _set_approval(client, False)
    day = business_today()
    swap_id = await _request_swap(client, schedule, members, day=day)

    await login(client, "koord")
    moved = await client.post(
        "/api/v1/calendar/override",
        json={
            "schedule_id": str(schedule.id),
            "expected_version": schedule.version,
            "service_date": str(day),
            "role": "primary",
            "replacement_member_id": str(members["Ewa Lis"].id),
        },
    )
    assert moved.status_code == 200, moved.text

    await login(client, "marek")
    accepted = await client.post(f"/api/v1/swaps/{swap_id}/accept")
    assert accepted.status_code == 409, accepted.text
    assert accepted.json()["detail"] == (
        "Slot zmienił właściciela; prośba została automatycznie anulowana"
    )
    listed = (await client.get("/api/v1/swaps")).json()
    assert listed[0]["status"] == "cancelled"


async def test_a_request_already_with_a_coordinator_outlives_the_switch(client, db) -> None:
    """Turning the approval off leaves what already waits for a coordinator
    theirs to decide, with the approval e-mail an approval sends."""
    members = await _team(db)
    schedule = await _roster(db)
    swap_id = await _request_swap(client, schedule, members)
    await login(client, "marek")
    assert (await client.post(f"/api/v1/swaps/{swap_id}/accept")).json()["status"] == (
        "pending_coordinator"
    )

    await _set_approval(client, False)
    approved = await client.post(f"/api/v1/swaps/{swap_id}/approve")
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "approved"
    assert any("zatwierdzona" in row.subject for row in await _outbox(db))
