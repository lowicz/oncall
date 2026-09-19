"""QA7-L19: the "who is on call now" card needs a phone number, not just email."""

from datetime import date, timedelta

from oncall.models import AuthSource, UserRole
from tests.conftest import create_user, login


async def test_admin_sets_phone_on_creation(client, db) -> None:
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    created = await client.post(
        "/api/v1/admin/users",
        json={
            "username": "nowa",
            "first_name": "Anna",
            "last_name": "Nowak",
            "phone": "600 100 200",
            "role": "viewer",
        },
    )
    assert created.status_code == 201, created.text
    assert created.json()["user"]["phone"] == "600100200"


async def test_admin_rejects_an_implausible_phone_number(client, db) -> None:
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    created = await client.post(
        "/api/v1/admin/users",
        json={"username": "nowa", "first_name": "Anna", "phone": "abc", "role": "viewer"},
    )
    assert created.status_code == 422, created.text


async def test_admin_can_edit_phone_of_an_ldap_account(client, db) -> None:
    await create_user(db, "admin", role=UserRole.admin)
    ldap_user = await create_user(db, "ldapuser")
    ldap_user.auth_source = AuthSource.ldap
    db.add(ldap_user)
    await db.commit()
    await login(client, "admin")
    response = await client.patch(
        f"/api/v1/admin/users/{ldap_user.id}", json={"phone": "+48123456789"}
    )
    assert response.status_code == 200, response.text
    assert response.json()["phone"] == "+48123456789"


async def test_account_owner_updates_their_own_phone(client, db) -> None:
    await create_user(db, "anna", role=UserRole.member)
    await login(client, "anna")
    response = await client.patch("/api/v1/auth/me", json={"phone": "601-200-300"})
    assert response.status_code == 200, response.text
    assert response.json()["phone"] == "601200300"

    me = await client.get("/api/v1/auth/me")
    assert me.json()["phone"] == "601200300"


async def test_a_share_link_session_cannot_edit_a_phone(client, db) -> None:
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    created = await client.post(
        "/api/v1/admin/share-links",
        json={
            "label": "Test",
            "starts_on": str(date.today()),
            "ends_on": str(date.today() + timedelta(days=1)),
            "expires_days": 7,
        },
    )
    assert created.status_code == 201, created.text
    token = created.json()["url"].rsplit("/share/", 1)[1]
    guest = client.__class__(transport=client._transport, base_url="http://test")
    await guest.post("/api/v1/share/exchange", json={"token": token})
    response = await guest.patch("/api/v1/auth/me", json={"phone": "600100200"})
    assert response.status_code == 403
