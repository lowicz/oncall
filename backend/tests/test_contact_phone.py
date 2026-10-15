"""The "who is on call now" card needs a phone number, not just an e-mail, and
the call forwarding sends that number to the switchboard unchanged: stored as
Polish E.164, `+48` and nine digits, whatever shape a person typed it in."""

from datetime import date, timedelta

import pytest

from oncall.domain.vocabulary import AuthSource, UserRole
from oncall.i18n import translate
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
    assert created.json()["user"]["phone"] == "+48600100200"


@pytest.mark.parametrize(
    "typed",
    ["600100200", "600 100 200", "600-100-200", "48600100200", "+48 600 100 200", " +48600100200 "],
)
async def test_every_way_of_writing_a_polish_number_is_stored_as_e164(client, db, typed) -> None:
    await create_user(db, "anna", role=UserRole.member)
    await login(client, "anna")

    response = await client.patch("/api/v1/auth/me", json={"phone": typed})

    assert response.status_code == 200, response.text
    assert response.json()["phone"] == "+48600100200"


@pytest.mark.parametrize(
    "typed",
    [
        "abc",
        "60010020",  # eight digits
        "6001002001",  # ten digits
        "+49 170 1234567",  # another country
        "0048600100200",  # the 00 trunk prefix
        "+48 (22) 123 45 67",  # brackets
    ],
)
async def test_a_number_that_is_not_a_polish_one_is_refused_with_the_rule(client, db, typed):
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")

    created = await client.post(
        "/api/v1/admin/users",
        json={"username": "nowa", "first_name": "Anna", "phone": typed, "role": "viewer"},
    )

    assert created.status_code == 422, created.text
    assert created.json()["detail"][0]["msg"] == translate("validation.phone")


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
    assert response.json()["phone"] == "+48601200300"

    me = await client.get("/api/v1/auth/me")
    assert me.json()["phone"] == "+48601200300"


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
