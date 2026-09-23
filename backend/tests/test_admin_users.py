import uuid
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

from sqlalchemy import select, update

from oncall.domain.vocabulary import AuthSource, UserRole
from oncall.infrastructure.sqlalchemy.access_models import AccountToken
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.team_models import TeamMember
from tests.conftest import TEST_PASSWORD, create_user, login


def token_from(url: str) -> str:
    return parse_qs(urlparse(url).query)["token"][0]


async def test_activation_rejects_a_password_from_the_common_list(client, db) -> None:
    """QA7 par. 8, E2 review: the common-password check had 4 hardcoded
    entries instead of a real list; `Qwerty123456` passed activation (204)."""
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    created = await client.post(
        "/api/v1/admin/users",
        json={"username": "nowa2", "first_name": "Anna", "last_name": "Nowak"},
    )
    assert created.status_code == 201, created.text
    token = token_from(created.json()["activation_url"])

    weak = await client.post(
        "/api/v1/auth/activate", json={"token": token, "password": "Qwerty123456"}
    )
    assert weak.status_code == 422, weak.text

    repeated = await client.post(
        "/api/v1/auth/activate", json={"token": token, "password": "aaaaaaaaaaaa"}
    )
    assert repeated.status_code == 422, repeated.text

    activated = await client.post(
        "/api/v1/auth/activate", json={"token": token, "password": "a-genuinely-uncommon-phrase-42"}
    )
    assert activated.status_code == 204, activated.text


async def test_only_admin_can_manage_accounts(client, db) -> None:
    await create_user(db, "anna")
    await login(client, "anna")
    response = await client.post(
        "/api/v1/admin/users",
        json={"username": "new", "first_name": "Nowa", "last_name": "Osoba"},
    )
    assert response.status_code == 403


async def test_create_and_activate_local_account_with_one_time_link(client, db) -> None:
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    created = await client.post(
        "/api/v1/admin/users",
        json={
            "username": "nowa",
            "personnel_number": "000042",
            "first_name": "Anna",
            "last_name": "Nowak",
            "email": "anna@example.com",
            "role": "viewer",
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["user"]["auth_source"] == "local"
    assert body["user"]["personnel_number"] == "000042"
    token = token_from(body["activation_url"])

    token_info = await client.get(
        "/api/v1/auth/password-token", params={"token": token, "kind": "activation"}
    )
    assert token_info.status_code == 200
    assert token_info.json() == {"username": "nowa", "display_name": "Anna Nowak"}

    before = await client.post(
        "/api/v1/auth/login", json={"username": "nowa", "password": "new-password-123"}
    )
    assert before.status_code == 401
    activated = await client.post(
        "/api/v1/auth/activate", json={"token": token, "password": "new-password-123"}
    )
    assert activated.status_code == 204, activated.text
    reused = await client.post(
        "/api/v1/auth/activate", json={"token": token, "password": "other-password-123"}
    )
    assert reused.status_code == 400
    expired_info = await client.get(
        "/api/v1/auth/password-token", params={"token": token, "kind": "activation"}
    )
    assert expired_info.status_code == 400
    signed_in = await client.post(
        "/api/v1/auth/login", json={"username": "nowa", "password": "new-password-123"}
    )
    assert signed_in.status_code == 200


async def test_duplicate_login_and_personnel_number_return_conflict(client, db) -> None:
    admin = await create_user(db, "admin", role=UserRole.admin)
    admin.personnel_number = "001"
    await db.commit()
    await login(client, "admin")
    duplicate_login = await client.post(
        "/api/v1/admin/users",
        json={"username": " ADMIN ", "first_name": "Inny"},
    )
    duplicate_number = await client.post(
        "/api/v1/admin/users",
        json={"username": "inny", "personnel_number": "001", "first_name": "Inny"},
    )
    assert duplicate_login.status_code == 409
    assert duplicate_number.status_code == 409

    admin.email = "Admin@Example.com"
    await db.commit()
    duplicate_email = await client.post(
        "/api/v1/admin/users",
        json={"username": "email-owner", "first_name": "Inny", "email": "admin@example.com"},
    )
    assert duplicate_email.status_code == 409


async def test_admin_cannot_change_own_role_or_status(client, db) -> None:
    admin = await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    for payload in ({"role": "viewer"}, {"is_active": False}):
        response = await client.patch(f"/api/v1/admin/users/{admin.id}", json=payload)
        assert response.status_code == 409
        assert "własnej roli ani statusu" in response.json()["detail"]


async def test_ldap_personal_data_and_password_are_read_only(client, db) -> None:
    await create_user(db, "admin", role=UserRole.admin)
    ldap_user = await create_user(db, "ldap-user")
    ldap_user.auth_source = AuthSource.ldap
    ldap_user.password_hash = None
    await db.commit()
    await login(client, "admin")

    personal = await client.patch(
        f"/api/v1/admin/users/{ldap_user.id}", json={"first_name": "Zmienione"}
    )
    reset = await client.post(f"/api/v1/admin/users/{ldap_user.id}/reset")
    role = await client.patch(f"/api/v1/admin/users/{ldap_user.id}", json={"role": "viewer"})
    assert personal.status_code == 409
    assert reset.status_code == 409
    assert role.status_code == 200
    assert role.json()["role"] == "viewer"


async def test_password_reset_link_is_one_time_and_revokes_sessions(client, db) -> None:
    await create_user(db, "admin", role=UserRole.admin)
    user = await create_user(db, "anna")
    await login(client, "admin")
    issued = await client.post(f"/api/v1/admin/users/{user.id}/reset")
    assert issued.status_code == 200
    token = token_from(issued.json()["url"])
    reset = await client.post(
        "/api/v1/auth/reset", json={"token": token, "password": "changed-password-123"}
    )
    assert reset.status_code == 204
    reused = await client.post(
        "/api/v1/auth/reset", json={"token": token, "password": "changed-password-456"}
    )
    assert reused.status_code == 400
    old = await client.post(
        "/api/v1/auth/login", json={"username": "anna", "password": TEST_PASSWORD}
    )
    new = await client.post(
        "/api/v1/auth/login", json={"username": "anna", "password": "changed-password-123"}
    )
    assert old.status_code == 401
    assert new.status_code == 200


async def test_rotation_and_eligibility_periods_are_managed_separately(client, db) -> None:
    await create_user(db, "admin", role=UserRole.admin)
    user = await create_user(db, "anna", role=UserRole.member, display_name="Anna Nowak")
    await login(client, "admin")
    joined = await client.post(
        "/api/v1/admin/team-members",
        json={"user_id": str(user.id), "active_from": "2026-01-01"},
    )
    assert joined.status_code == 201, joined.text
    member_id = joined.json()["id"]
    assert joined.json()["eligibility"] == []

    first = await client.post(
        f"/api/v1/admin/team-members/{member_id}/eligibility",
        json={"role": "primary", "starts_on": "2026-02-01"},
    )
    assert first.status_code == 201, first.text
    overlap = await client.post(
        f"/api/v1/admin/team-members/{member_id}/eligibility",
        json={"role": "primary", "starts_on": "2026-03-01"},
    )
    assert overlap.status_code == 409
    closed = await client.patch(
        f"/api/v1/admin/eligibility/{first.json()['id']}", json={"ends_on": "2026-02-28"}
    )
    assert closed.status_code == 200
    second = await client.post(
        f"/api/v1/admin/team-members/{member_id}/eligibility",
        json={"role": "primary", "starts_on": "2026-03-01"},
    )
    assert second.status_code == 201

    invalid_exit = await client.patch(
        f"/api/v1/admin/team-members/{member_id}", json={"active_until": "2026-02-15"}
    )
    assert invalid_exit.status_code == 409
    member = await db.scalar(select(TeamMember).where(TeamMember.id == uuid.UUID(member_id)))
    assert member is not None


async def test_admin_changes_are_audited(client, db) -> None:
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    await client.post("/api/v1/admin/users", json={"username": "new", "first_name": "Nowa"})
    actions = set(await db.scalars(select(AuditEvent.action)))
    assert "admin.user_created" in actions


def expiry(user: dict) -> datetime:
    return datetime.fromisoformat(user["pending_activation"]["link_expires_at"])


async def listed(client) -> dict[str, dict]:
    response = await client.get("/api/v1/admin/users")
    assert response.status_code == 200, response.text
    return {user["username"]: user for user in response.json()}


async def test_the_list_tells_pending_activations_from_activated_accounts(client, db) -> None:
    await create_user(db, "admin", role=UserRole.admin)
    ldap_user = await create_user(db, "ldap-user")
    ldap_user.auth_source = AuthSource.ldap
    ldap_user.password_hash = None
    await db.commit()
    await login(client, "admin")
    created = {}
    for username in ("czeka", "aktywna", "wygasla", "wylaczona"):
        response = await client.post(
            "/api/v1/admin/users", json={"username": username, "first_name": username}
        )
        assert response.status_code == 201, response.text
        created[username] = response.json()
    activated = await client.post(
        "/api/v1/auth/activate",
        json={
            "token": token_from(created["aktywna"]["activation_url"]),
            "password": "x-Pass-4242-y",
        },
    )
    assert activated.status_code == 204, activated.text
    await db.execute(
        update(AccountToken)
        .where(AccountToken.user_id == uuid.UUID(created["wygasla"]["user"]["id"]))
        .values(expires_at=datetime.now(UTC) - timedelta(hours=1))
    )
    await db.commit()
    disabled = await client.patch(
        f"/api/v1/admin/users/{created['wylaczona']['user']['id']}", json={"is_active": False}
    )
    assert disabled.status_code == 200, disabled.text

    users = await listed(client)

    now = datetime.now(UTC)
    assert created["czeka"]["user"]["pending_activation"] is not None
    assert timedelta(hours=23) < expiry(users["czeka"]) - now <= timedelta(hours=24)
    assert users["czeka"]["is_active"] is True
    assert expiry(users["wygasla"]) < now
    assert users["wylaczona"]["is_active"] is False
    assert users["wylaczona"]["pending_activation"] is not None
    assert disabled.json()["pending_activation"] is not None
    for username in ("aktywna", "admin", "ldap-user"):
        assert users[username]["pending_activation"] is None


async def test_an_expired_activation_link_is_replaced_by_a_fresh_one(client, db) -> None:
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    created = (
        await client.post("/api/v1/admin/users", json={"username": "nowa", "first_name": "Nowa"})
    ).json()
    user_id = created["user"]["id"]
    await db.execute(
        update(AccountToken)
        .where(AccountToken.user_id == uuid.UUID(user_id))
        .values(expires_at=datetime.now(UTC) - timedelta(minutes=1))
    )
    await db.commit()

    reissued = await client.post(f"/api/v1/admin/users/{user_id}/activation")

    assert reissued.status_code == 200, reissued.text
    body = reissued.json()
    assert urlparse(body["url"]).path == "/activate"
    issued_until = datetime.fromisoformat(body["expires_at"])
    assert timedelta(hours=23) < issued_until - datetime.now(UTC) <= timedelta(hours=24)
    assert expiry((await listed(client))["nowa"]) == issued_until
    old = await client.post(
        "/api/v1/auth/activate",
        json={"token": token_from(created["activation_url"]), "password": "x-Pass-4242-y"},
    )
    assert old.status_code == 400
    again = await client.post(f"/api/v1/admin/users/{user_id}/activation")
    superseded = await client.post(
        "/api/v1/auth/activate",
        json={"token": token_from(body["url"]), "password": "x-Pass-4242-y"},
    )
    assert superseded.status_code == 400
    activated = await client.post(
        "/api/v1/auth/activate",
        json={"token": token_from(again.json()["url"]), "password": "x-Pass-4242-y"},
    )
    assert activated.status_code == 204, activated.text
    assert (await listed(client))["nowa"]["pending_activation"] is None
    actions = list(
        await db.scalars(
            select(AuditEvent.action).where(AuditEvent.action == "admin.activation_link_issued")
        )
    )
    assert len(actions) == 2

    after = await client.post(f"/api/v1/admin/users/{user_id}/activation")
    assert after.status_code == 409
    assert "reset hasła" in after.json()["detail"]


async def test_only_an_admin_reissues_an_activation_link_and_only_when_it_applies(
    client, db
) -> None:
    await create_user(db, "admin", role=UserRole.admin)
    await create_user(db, "koordynator", role=UserRole.coordinator)
    ldap_user = await create_user(db, "ldap-user")
    ldap_user.auth_source = AuthSource.ldap
    ldap_user.password_hash = None
    await db.commit()
    await login(client, "admin")
    pending = (
        await client.post("/api/v1/admin/users", json={"username": "nowa", "first_name": "Nowa"})
    ).json()["user"]
    disabled = (
        await client.post("/api/v1/admin/users", json={"username": "off", "first_name": "Off"})
    ).json()["user"]
    await client.patch(f"/api/v1/admin/users/{disabled['id']}", json={"is_active": False})

    directory = await client.post(f"/api/v1/admin/users/{ldap_user.id}/activation")
    switched_off = await client.post(f"/api/v1/admin/users/{disabled['id']}/activation")
    missing = await client.post(f"/api/v1/admin/users/{uuid.uuid4()}/activation")
    csrf = client.headers.pop("X-CSRF-Token")
    without_csrf = await client.post(f"/api/v1/admin/users/{pending['id']}/activation")
    client.headers["X-CSRF-Token"] = csrf

    assert directory.status_code == 409
    assert switched_off.status_code == 409
    assert "wyłączone" in switched_off.json()["detail"]
    assert missing.status_code == 404
    assert without_csrf.status_code == 403

    await login(client, "koordynator")
    coordinator = await client.post(f"/api/v1/admin/users/{pending['id']}/activation")
    assert coordinator.status_code == 403
    issued = list(
        await db.scalars(
            select(AuditEvent.action).where(AuditEvent.action == "admin.activation_link_issued")
        )
    )
    assert issued == []
