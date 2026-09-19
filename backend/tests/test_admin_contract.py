"""The administration API's answers, pinned before its rules moved into
`oncall.domain.admin`: every refusal's status and message, what a success
returns, and what the audit trail says afterwards."""

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select

from oncall.models import (
    AccountToken,
    Assignment,
    AssignmentRole,
    AuditEvent,
    AuthSource,
    Eligibility,
    TeamMember,
    User,
    UserRole,
)
from tests.conftest import create_member, create_published_schedule, create_user, login

TODAY = date.today()


def assert_error(response, status_code: int, detail) -> None:
    assert (response.status_code, response.json()["detail"]) == (status_code, detail)


async def _audit(db, action: str) -> AuditEvent:
    return await db.scalar(
        select(AuditEvent).where(AuditEvent.action == action).order_by(AuditEvent.occurred_at)
    )


@pytest.fixture
async def admin(client, db) -> User:
    user = await create_user(db, "admin", role=UserRole.admin, display_name="Ada Admin")
    await login(client, "admin")
    return user


async def test_creating_an_account(client, db, admin) -> None:
    await create_user(db, "zajety", email="zajety@example.com")
    taken = await db.scalar(select(User).where(User.username == "zajety"))
    taken.personnel_number = "123"
    await db.commit()

    base = {"username": "nowy", "first_name": "Nowa", "last_name": "Osoba"}
    assert_error(
        await client.post("/api/v1/admin/users", json={**base, "first_name": "   "}),
        422,
        "Imię nie może być puste",
    )
    assert_error(
        await client.post("/api/v1/admin/users", json={**base, "username": "Zajety"}),
        409,
        "Konto o takim loginie już istnieje",
    )
    assert_error(
        await client.post("/api/v1/admin/users", json={**base, "email": "ZAJETY@example.com"}),
        409,
        "Konto o takim adresie e-mail już istnieje",
    )
    assert_error(
        await client.post("/api/v1/admin/users", json={**base, "personnel_number": "123"}),
        409,
        "Numer pracownika jest już używany",
    )

    created = await client.post(
        "/api/v1/admin/users",
        json={**base, "first_name": " Nowa ", "email": "nowa@example.com", "role": "member"},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["activation_url"].startswith("http")
    assert "/activate?token=" in body["activation_url"]
    user = body["user"]
    assert {key: user[key] for key in user if key not in {"id", "created_at"}} == {
        "username": "nowy",
        "personnel_number": None,
        "first_name": "Nowa",
        "last_name": "Osoba",
        "display_name": "Nowa Osoba",
        "auth_source": "local",
        "role": "member",
        "email": "nowa@example.com",
        "phone": None,
        "is_active": True,
    }
    assert datetime.fromisoformat(user["created_at"])
    event = await _audit(db, "admin.user_created")
    assert (event.entity_id, event.summary, event.details) == (
        user["id"],
        "Utworzono lokalne konto nowy",
        {"role": "member"},
    )
    tokens = (await db.scalars(select(AccountToken))).all()
    assert [(token.kind.value, token.used_at) for token in tokens] == [("activation", None)]


async def test_updating_an_account(client, db, admin) -> None:
    second_admin = await create_user(db, "admin2", role=UserRole.admin, display_name="Bo Admin")
    other = await create_user(db, "inny", email="inny@example.com", display_name="Inny Ktoś")
    other.personnel_number = "77"
    person = await create_user(db, "osoba", display_name="Ola Nowak")
    member = await create_member(db, person, display_name="Ola Nowak")
    ldap = await create_user(db, "ldapowy", display_name="Lu Dap")
    ldap.auth_source = AuthSource.ldap
    await db.commit()
    await create_published_schedule(db, starts_on=TODAY, days=1, primary=["Ola Nowak"])
    row = await db.scalar(select(Assignment).where(Assignment.role == AssignmentRole.primary))
    row.member_id = member.id
    await db.commit()

    def patch(target: User, **changes):
        return client.patch(f"/api/v1/admin/users/{target.id}", json=changes)

    assert_error(
        await client.patch(f"/api/v1/admin/users/{uuid.uuid4()}", json={"phone": None}),
        404,
        "Nie znaleziono użytkownika",
    )
    assert_error(
        await patch(ldap, email="x@example.com"),
        409,
        "Dane osobowe konta LDAP są zarządzane przez AD",
    )
    assert (await patch(ldap, role="coordinator")).status_code == 200
    assert_error(
        await patch(admin, role="member"), 409, "Nie możesz zmienić własnej roli ani statusu"
    )
    assert (await patch(admin, role="admin", is_active=True)).status_code == 200
    assert_error(await patch(person, first_name=None), 409, "Imię nie może być puste")
    assert_error(await patch(person, last_name=None), 409, "Nazwisko nie może być wartością null")
    assert_error(
        await patch(person, personnel_number="77"), 409, "Numer pracownika jest już używany"
    )
    assert_error(
        await patch(person, email="INNY@example.com"),
        409,
        "Konto o takim adresie e-mail już istnieje",
    )
    assert (await patch(other, personnel_number="77", email="inny@example.com")).status_code == 200

    renamed = await patch(person, first_name=" Aleksandra ", email="ola@example.com")
    assert renamed.status_code == 200, renamed.text
    assert (renamed.json()["display_name"], renamed.json()["email"]) == (
        "Aleksandra Nowak",
        "ola@example.com",
    )
    await db.refresh(member)
    await db.refresh(row)
    assert (member.display_name, row.assignee_name) == ("Aleksandra Nowak", "Aleksandra Nowak")
    event = (
        await db.scalars(
            select(AuditEvent).where(
                AuditEvent.action == "admin.user_updated", AuditEvent.entity_id == str(person.id)
            )
        )
    ).one()
    assert (event.summary, event.details) == (
        "Zaktualizowano konto osoba",
        {"fields": ["email", "first_name"], "before": {"email": None, "first_name": "Ola"}},
    )

    assert (await patch(second_admin, role="member")).status_code == 200


async def test_password_reset_links(client, db, admin) -> None:
    local = await create_user(db, "lokalny")
    ldap = await create_user(db, "katalog")
    ldap.auth_source = AuthSource.ldap
    await db.commit()

    assert_error(
        await client.post(f"/api/v1/admin/users/{uuid.uuid4()}/reset"),
        404,
        "Nie znaleziono użytkownika",
    )
    assert_error(
        await client.post(f"/api/v1/admin/users/{ldap.id}/reset"),
        409,
        "Hasło konta LDAP jest zarządzane przez AD",
    )
    first = await client.post(f"/api/v1/admin/users/{local.id}/reset")
    second = await client.post(f"/api/v1/admin/users/{local.id}/reset")
    assert first.status_code == second.status_code == 200
    assert "/reset?token=" in second.json()["url"]
    expires_at = datetime.fromisoformat(second.json()["expires_at"])
    assert timedelta(minutes=59) < expires_at - datetime.now(UTC) <= timedelta(hours=1)
    tokens = (await db.scalars(select(AccountToken).order_by(AccountToken.created_at))).all()
    assert [token.used_at is None for token in tokens] == [False, True]
    event = await _audit(db, "admin.password_reset_issued")
    assert (event.entity_id, event.summary) == (
        str(local.id),
        "Wygenerowano link resetu hasła dla lokalny",
    )


async def test_deleting_an_account(client, db, admin) -> None:
    free = await create_user(db, "wolny", display_name="Wo Lny")
    await create_member(db, free, display_name="Wo Lny")
    await db.commit()

    assert_error(
        await client.delete(f"/api/v1/admin/users/{uuid.uuid4()}"),
        404,
        "Nie znaleziono użytkownika",
    )
    assert_error(
        await client.delete(f"/api/v1/admin/users/{admin.id}"),
        409,
        "Nie możesz usunąć własnego konta",
    )
    assert await _audit(db, "admin.user_deleted") is None

    assert (await client.delete(f"/api/v1/admin/users/{free.id}")).status_code == 204
    event = await _audit(db, "admin.user_deleted")
    assert (event.entity_id, event.summary, event.details) == (
        str(free.id),
        "Usunięto konto i dane osobowe: wolny",
        {"display_name": "Wo Lny"},
    )
    orphan = await db.scalar(select(TeamMember).where(TeamMember.display_name == "Wo Lny"))
    assert orphan is not None and orphan.user_id is None


async def test_rotation_membership(client, db, admin) -> None:
    person = await create_user(db, "osoba", display_name="Ola Nowak")
    assert_error(
        await client.post(
            "/api/v1/admin/team-members",
            json={"user_id": str(uuid.uuid4()), "active_from": TODAY.isoformat()},
        ),
        404,
        "Nie znaleziono użytkownika",
    )
    created = await client.post(
        "/api/v1/admin/team-members",
        json={"user_id": str(person.id), "active_from": TODAY.isoformat()},
    )
    assert created.status_code == 201, created.text
    member_id = created.json()["id"]
    assert created.json() == {
        "id": member_id,
        "user_id": str(person.id),
        "display_name": "Ola Nowak",
        "active_from": TODAY.isoformat(),
        "active_until": None,
        "eligibility": [],
    }
    assert (await _audit(db, "admin.team_member_created")).summary == (
        f"Dodano Ola Nowak do rotacji od {TODAY}"
    )
    assert_error(
        await client.post(
            "/api/v1/admin/team-members",
            json={"user_id": str(person.id), "active_from": TODAY.isoformat()},
        ),
        409,
        "Konto jest już przypisane do rotacji",
    )

    url = f"/api/v1/admin/team-members/{member_id}"
    assert_error(
        await client.patch(f"/api/v1/admin/team-members/{uuid.uuid4()}", json={}),
        404,
        "Nie znaleziono osoby w rotacji",
    )
    assert_error(
        await client.patch(url, json={"active_until": (TODAY - timedelta(days=1)).isoformat()}),
        409,
        "Data wyjścia z rotacji nie może poprzedzać daty wejścia",
    )
    granted = await client.post(
        f"{url}/eligibility",
        json={"role": "primary", "starts_on": (TODAY + timedelta(days=5)).isoformat()},
    )
    assert granted.status_code == 201, granted.text
    assert_error(
        await client.patch(url, json={"active_until": (TODAY + timedelta(days=10)).isoformat()}),
        409,
        "Okresy eligibility muszą mieścić się w okresie członkostwa w rotacji",
    )
    await client.delete(f"/api/v1/admin/eligibility/{granted.json()['id']}")

    await create_published_schedule(
        db, starts_on=TODAY + timedelta(days=20), days=2, primary=["Ola Nowak"]
    )
    rows = (await db.scalars(select(Assignment))).all()
    for row in rows:
        row.member_id = uuid.UUID(member_id)
    await db.commit()
    until = TODAY + timedelta(days=19)
    assert_error(
        await client.patch(url, json={"active_until": until.isoformat()}),
        409,
        "Osoba ma dyżury po dacie wyjścia z rotacji. Najpierw przepisz lub zwolnij sloty: "
        + ", ".join(
            f"{TODAY + timedelta(days=20 + offset)} ({role})"
            for offset in range(2)
            for role in ("primary", "secondary", "late_shift")
        ),
    )
    moved = await client.patch(url, json={"active_until": (TODAY + timedelta(days=30)).isoformat()})
    assert moved.status_code == 200, moved.text
    assert moved.json()["active_until"] == (TODAY + timedelta(days=30)).isoformat()
    event = (
        await db.scalars(select(AuditEvent).where(AuditEvent.action == "admin.team_member_updated"))
    ).one()
    assert (event.summary, event.details) == (
        "Zaktualizowano okres rotacji: Ola Nowak",
        {"fields": ["active_until"]},
    )


async def test_eligibility_periods(client, db, admin) -> None:
    person = await create_user(db, "osoba", display_name="Ola Nowak")
    member = TeamMember(
        user_id=person.id,
        display_name="Ola Nowak",
        active_from=TODAY,
        active_until=TODAY + timedelta(days=60),
    )
    db.add(member)
    await db.commit()
    url = f"/api/v1/admin/team-members/{member.id}/eligibility"

    def grant(starts: int, ends: int | None, role: str = "primary"):
        body = {"role": role, "starts_on": (TODAY + timedelta(days=starts)).isoformat()}
        if ends is not None:
            body["ends_on"] = (TODAY + timedelta(days=ends)).isoformat()
        return client.post(url, json=body)

    assert_error(
        await client.post(
            f"/api/v1/admin/team-members/{uuid.uuid4()}/eligibility",
            json={"role": "primary", "starts_on": TODAY.isoformat()},
        ),
        404,
        "Nie znaleziono osoby w rotacji",
    )
    outside = "Okres eligibility musi mieścić się w okresie członkostwa w rotacji"
    assert_error(await grant(-1, 10), 409, outside)
    assert_error(await grant(0, None), 409, outside)
    assert_error(await grant(0, 61), 409, outside)
    first = await grant(0, 20)
    assert first.status_code == 201, first.text
    assert first.json() == {
        "id": first.json()["id"],
        "role": "primary",
        "starts_on": TODAY.isoformat(),
        "ends_on": (TODAY + timedelta(days=20)).isoformat(),
    }
    assert (await _audit(db, "admin.eligibility_created")).summary == (
        f"Nadano Ola Nowak eligibility primary od {TODAY}"
    )
    overlap = "Okres eligibility nakłada się na istniejący okres tej roli"
    assert_error(await grant(20, 30), 409, overlap)
    assert (await grant(20, 30, role="secondary")).status_code == 201
    second = await grant(21, 40)
    assert second.status_code == 201

    item_url = f"/api/v1/admin/eligibility/{first.json()['id']}"
    assert_error(
        await client.patch(f"/api/v1/admin/eligibility/{uuid.uuid4()}", json={}),
        404,
        "Nie znaleziono okresu eligibility",
    )
    assert_error(
        await client.patch(item_url, json={"ends_on": (TODAY - timedelta(days=1)).isoformat()}),
        409,
        "Data końcowa nie może poprzedzać daty początkowej",
    )
    assert_error(await client.patch(item_url, json={"ends_on": None}), 409, outside)
    assert_error(
        await client.patch(item_url, json={"ends_on": (TODAY + timedelta(days=25)).isoformat()}),
        409,
        overlap,
    )

    await create_published_schedule(
        db, starts_on=TODAY + timedelta(days=10), days=1, primary=["Ola Nowak"]
    )
    for row in (await db.scalars(select(Assignment))).all():
        row.member_id = member.id
    await db.commit()
    uncovered = (
        "Zmiana eligibility pozostawiłaby opublikowane dyżury bez uprawnień. "
        f"Najpierw przepisz sloty: {TODAY + timedelta(days=10)} (primary)"
    )
    assert_error(
        await client.patch(item_url, json={"ends_on": (TODAY + timedelta(days=5)).isoformat()}),
        409,
        uncovered,
    )
    assert_error(await client.delete(item_url), 409, uncovered)
    assert_error(
        await client.delete(f"/api/v1/admin/eligibility/{uuid.uuid4()}"),
        404,
        "Nie znaleziono okresu eligibility",
    )

    changed = await client.patch(
        item_url, json={"starts_on": (TODAY + timedelta(days=1)).isoformat()}
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["starts_on"] == (TODAY + timedelta(days=1)).isoformat()
    event = await _audit(db, "admin.eligibility_updated")
    assert (event.summary, event.details) == (
        "Zaktualizowano eligibility primary: Ola Nowak",
        {"fields": ["starts_on"]},
    )
    second_url = f"/api/v1/admin/eligibility/{second.json()['id']}"
    assert (await client.delete(second_url)).status_code == 204
    event = await _audit(db, "admin.eligibility_deleted")
    assert (event.summary, event.details) == (
        "Usunięto eligibility primary: Ola Nowak",
        {
            "starts_on": (TODAY + timedelta(days=21)).isoformat(),
            "ends_on": (TODAY + timedelta(days=40)).isoformat(),
        },
    )
    remaining = (
        await db.scalars(select(Eligibility.role).where(Eligibility.member_id == member.id))
    ).all()
    assert sorted(remaining) == ["primary", "secondary"]


async def test_audit_listing_hides_logins_unless_asked(client, db, admin) -> None:
    listed = await client.get("/api/v1/admin/audit")
    assert listed.headers["X-Oncall-Logins-Excluded"] == "true"
    assert all(item["action"] != "auth.login" for item in listed.json())

    logins = await client.get("/api/v1/admin/audit", params={"action": "auth.login"})
    assert logins.headers["X-Oncall-Logins-Excluded"] == "false"
    assert {item["action"] for item in logins.json()} == {"auth.login"}
    assert logins.json()[0]["actor_label"] == "Ada Admin"

    included = await client.get(
        "/api/v1/admin/audit", params={"include_logins": "true", "q": "Ada", "limit": 1}
    )
    assert included.headers["X-Oncall-Logins-Excluded"] == "false"
    assert len(included.json()) == 1
    future = (TODAY + timedelta(days=1)).isoformat()
    assert (
        await client.get("/api/v1/admin/audit", params={"starts_on": future, "include_logins": 1})
    ).json() == []
