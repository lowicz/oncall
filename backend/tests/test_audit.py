from datetime import date, timedelta

from sqlalchemy import func, select

from oncall.audit import record_audit
from oncall.models import AuditEvent, UserRole
from tests.conftest import (
    create_member,
    create_published_schedule,
    create_user,
    login,
)


async def _events(db) -> list[AuditEvent]:
    return (await db.scalars(select(AuditEvent).order_by(AuditEvent.occurred_at))).all()


async def test_record_audit_stores_denormalized_actor(db) -> None:
    user = await create_user(db, "anna")
    record_audit(
        db,
        actor=user,
        action="swap.approved",
        entity_type="swap",
        entity_id="123",
        summary="Zatwierdzono zamianę",
        details={"x": 1},
    )
    await db.commit()
    event = (await _events(db))[0]
    assert event.actor_label == user.display_name
    assert event.actor_user_id == user.id
    assert event.action == "swap.approved"
    assert event.details == {"x": 1}


async def test_record_audit_system_actor(db) -> None:
    record_audit(db, actor=None, action="system.test", summary="Zdarzenie systemowe")
    await db.commit()
    event = (await _events(db))[0]
    assert event.actor_label == "system"
    assert event.actor_user_id is None


async def test_login_success_and_failure_are_audited(client, db) -> None:
    await create_user(db, "anna")
    failed = await client.post(
        "/api/v1/auth/login", json={"username": "anna", "password": "wrong-password"}
    )
    assert failed.status_code == 401
    await login(client, "anna")
    events = await _events(db)
    actions = [event.action for event in events]
    assert "auth.login_failed" in actions
    assert "auth.login" in actions
    failure = next(event for event in events if event.action == "auth.login_failed")
    assert failure.actor_label == "anna"


async def test_override_and_share_link_flow_are_audited(client, db) -> None:
    today = date.today()
    anna = await create_user(db, "anna", email="a@x.com", display_name="Anna Kowalska")
    marek = await create_user(db, "marek", email="m@x.com", display_name="Marek Nowak")
    ola = await create_user(db, "ola", email="o@x.com", display_name="Ola Wiśniewska")
    await create_member(db, anna, display_name="Anna Kowalska")
    await create_member(db, marek, display_name="Marek Nowak")
    ola_member = await create_member(db, ola, display_name="Ola Wiśniewska")
    schedule = await create_published_schedule(
        db,
        starts_on=today,
        days=7,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Marek Nowak"],
    )
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    override = await client.post(
        "/api/v1/calendar/override",
        json={
            "schedule_id": str(schedule.id),
            "expected_version": schedule.version,
            "service_date": str(today + timedelta(days=1)),
            "role": "primary",
            "replacement_member_id": str(ola_member.id),
        },
    )
    assert override.status_code == 200, override.text

    link = await client.post(
        "/api/v1/admin/share-links",
        json={
            "label": "Audyt",
            "starts_on": str(today),
            "ends_on": str(today + timedelta(days=2)),
            "expires_days": 3,
        },
    )
    assert link.status_code == 201, link.text
    token = link.json()["url"].rsplit("/share/", 1)[1]
    guest = client.__class__(transport=client._transport, base_url="http://test")
    exchanged = await guest.post("/api/v1/share/exchange", json={"token": token})
    assert exchanged.status_code == 200

    events = await _events(db)
    by_action = {event.action: event for event in events}
    assert by_action["schedule.override"].actor_label == "Admin"
    assert "Anna Kowalska → Ola Wiśniewska" in by_action["schedule.override"].summary
    assert by_action["share_link.created"].actor_label == "Admin"
    assert by_action["share_link.exchanged"].actor_label == "link: Audyt"


async def test_audit_list_requires_admin(client, db) -> None:
    await create_user(db, "anna")
    await login(client, "anna")
    assert (await client.get("/api/v1/admin/audit")).status_code == 403


async def test_audit_list_filters_and_paginates(client, db) -> None:
    admin = await create_user(db, "admin", role=UserRole.admin)
    for index in range(5):
        record_audit(db, actor=admin, action="swap.created", summary=f"zdarzenie {index}")
    record_audit(db, actor=admin, action="auth.login", summary="logowanie")
    await db.commit()
    await login(client, "admin")

    swaps = (await client.get("/api/v1/admin/audit", params={"action": "swap.created"})).json()
    assert len(swaps) == 5
    assert all(item["action"] == "swap.created" for item in swaps)
    page = (await client.get("/api/v1/admin/audit", params={"limit": 2, "offset": 2})).json()
    assert len(page) == 2
    first_page = (await client.get("/api/v1/admin/audit", params={"limit": 2})).json()
    assert page[0]["id"] != first_page[0]["id"]
    by_type = (await client.get("/api/v1/admin/audit", params={"entity_type": "swap"})).json()
    assert by_type == [] or all(item["entity_type"] == "swap" for item in by_type)


async def test_audit_search_signals_that_matching_logins_are_hidden(client, db) -> None:
    admin = await create_user(db, "admin-hidden-login", role=UserRole.admin)
    record_audit(db, actor=admin, action="auth.login", summary="Zalogowano do systemu")
    await db.commit()
    await login(client, "admin-hidden-login")

    hidden = await client.get("/api/v1/admin/audit", params={"q": "Zalogowano"})
    assert hidden.status_code == 200
    assert hidden.json() == []
    assert hidden.headers["X-Oncall-Logins-Excluded"] == "true"

    visible = await client.get(
        "/api/v1/admin/audit", params={"q": "Zalogowano", "include_logins": "true"}
    )
    assert visible.status_code == 200
    assert any(item["action"] == "auth.login" for item in visible.json())
    assert visible.headers["X-Oncall-Logins-Excluded"] == "false"


async def test_availability_and_policy_changes_are_audited(client, db) -> None:
    today = date.today()
    anna = await create_user(db, "anna", display_name="Anna Kowalska")
    await create_member(db, anna, display_name="Anna Kowalska")
    await login(client, "anna")
    created = await client.post(
        "/api/v1/availability/me",
        json={
            "kind": "unavailable",
            "starts_on": str(today),
            "ends_on": str(today + timedelta(days=1)),
        },
    )
    assert created.status_code == 201, created.text
    await client.delete(f"/api/v1/availability/me/{created.json()['id']}")

    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    updated = await client.put(
        "/api/v1/scheduling/policy",
        json={
            "rotation_mode": "weekly",
            "fairness_weight": 2.5,
            "continuity_weight": 1.5,
            "preference_weight": 0.5,
            "late_shift_anchor": "primary",
        },
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["fairness_weight"] == 2.5
    assert updated.json()["rotation_mode"] == "weekly"
    assert updated.json()["late_shift_anchor"] == "primary"

    count = await db.scalar(select(func.count()).select_from(AuditEvent))
    assert count >= 3
    events = await _events(db)
    actions = [event.action for event in events]
    assert "availability.created" in actions
    assert "availability.deleted" in actions
    assert "policy.updated" in actions
    policy_event = next(event for event in events if event.action == "policy.updated")
    assert "weekly" in policy_event.summary
    assert policy_event.details["fairness_weight"] == 2.5


async def test_policy_update_keeps_unset_weights(client, db) -> None:
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    await client.put(
        "/api/v1/scheduling/policy",
        json={"rotation_mode": "daily", "fairness_weight": 7.0},
    )
    updated = await client.put("/api/v1/scheduling/policy", json={"rotation_mode": "weekly"})
    assert updated.json()["fairness_weight"] == 7.0
    assert updated.json()["rotation_mode"] == "weekly"


async def test_policy_rejects_all_objective_weights_set_to_zero(client, db) -> None:
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")

    response = await client.put(
        "/api/v1/scheduling/policy",
        json={
            "rotation_mode": "hybrid",
            "fairness_weight": 0,
            "continuity_weight": 0,
            "preference_weight": 0,
        },
    )

    assert response.status_code == 422
    assert "Co najmniej jedna waga" in response.text
