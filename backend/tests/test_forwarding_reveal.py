"""Revealing the stored WCO password to an administrator, so the number can
be switched by hand in WCO's own panel when the forwarding pass cannot.

Administrators only, after entering their own sign-in password again, which
is checked the way signing in checks it and counted by the same throttle.
The value comes back in that one response, never cached, and in no log and
no audit entry: the entry says who looked and when.
"""

import logging
from datetime import UTC, datetime

import pytest
from cryptography.fernet import Fernet
from pydantic import SecretStr
from sqlalchemy import select, update

from oncall import secrets
from oncall.config import get_settings
from oncall.domain.clock import as_utc
from oncall.domain.vocabulary import UserRole
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.forwarding_models import CallForwardingSettings
from oncall.ldap_auth import DirectoryUnavailableError
from tests.conftest import TEST_PASSWORD, create_user, login
from tests.test_ldap_auth import FakeDirectory, directory_identity, use_directory

SETTINGS = "/api/v1/admin/forwarding/settings"
REVEAL = "/api/v1/admin/forwarding/password/reveal"
#: Dummy WCO passwords; no test holds a real one.
PASSWORD = "Dummy-Haslo-WCO!1"
PENDING = "Dummy-Pending-WCO!2"
DIRECTORY_PASSWORD = "Dummy-Directory!3"


@pytest.fixture
def key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "secrets_key", SecretStr(Fernet.generate_key().decode()))


@pytest.fixture
async def admin(client, db) -> None:
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")


@pytest.fixture
async def stored(client, admin, key) -> None:
    response = await client.put(SETTINGS, json={"mode": "off", "password": PASSWORD})
    assert response.status_code == 200, response.text


async def _reveals(db) -> list[AuditEvent]:
    query = select(AuditEvent).where(AuditEvent.action == "forwarding.password_revealed")
    return list((await db.scalars(query)).all())


async def test_an_administrator_sees_the_password_after_confirming_it_is_them(
    client, db, stored, caplog
) -> None:
    caplog.set_level(logging.DEBUG)

    response = await client.post(REVEAL, json={"password": TEST_PASSWORD})

    assert response.status_code == 200, response.text
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["pragma"] == "no-cache"
    body = response.json()
    assert body == {
        "current": PASSWORD,
        "pending": None,
        "pending_since": None,
        "credentials_invalid_since": None,
        "password_changed_at": body["password_changed_at"],
    }
    assert body["password_changed_at"] is not None
    administrator = await db.scalar(select(User.id).where(User.username == "admin"))
    [event] = await _reveals(db)
    assert event.actor_user_id == administrator
    assert event.summary == "Odsłonięto hasło WCO"
    assert event.details == {"pending_included": False}
    for secret in (PASSWORD, TEST_PASSWORD):
        assert secret not in caplog.text
    assert PASSWORD not in (await client.get(SETTINGS)).text


async def test_during_a_rotation_both_passwords_come_back_pending_first(client, db, stored) -> None:
    pending_since = datetime(2026, 10, 1, 9, tzinfo=UTC)
    refused_at = datetime(2026, 10, 1, 9, 5, tzinfo=UTC)
    await db.execute(
        update(CallForwardingSettings).values(
            pending_password_ciphertext=secrets.encrypt(get_settings(), PENDING),
            pending_since=pending_since,
            credentials_invalid_since=refused_at,
        )
    )
    await db.commit()

    response = await client.post(REVEAL, json={"password": TEST_PASSWORD})

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["pending"], body["current"]) == (PENDING, PASSWORD)
    assert as_utc(datetime.fromisoformat(body["pending_since"])) == pending_since
    assert as_utc(datetime.fromisoformat(body["credentials_invalid_since"])) == refused_at
    [event] = await _reveals(db)
    assert event.details == {"pending_included": True}
    assert PENDING not in str(event.details)


@pytest.mark.parametrize("role", [UserRole.coordinator, UserRole.member])
async def test_only_an_administrator_may_reveal(client, db, role) -> None:
    await create_user(db, "kasia", role=role)
    await login(client, "kasia")

    response = await client.post(REVEAL, json={"password": TEST_PASSWORD})

    assert response.status_code == 403
    assert await _reveals(db) == []


async def test_a_reveal_needs_the_csrf_token(client, db, stored) -> None:
    del client.headers["X-CSRF-Token"]

    assert (await client.post(REVEAL, json={"password": TEST_PASSWORD})).status_code == 403
    assert await _reveals(db) == []


async def test_a_wrong_confirmation_is_a_failed_sign_in_and_reveals_nothing(
    client, db, stored
) -> None:
    response = await client.post(REVEAL, json={"password": "not-my-password"})

    assert response.status_code == 403
    assert response.json()["detail"] == "Nieprawidłowy login lub hasło"
    assert PASSWORD not in response.text
    assert await _reveals(db) == []
    failures = await db.scalars(
        select(AuditEvent.actor_label).where(AuditEvent.action == "auth.login_failed")
    )
    assert list(failures) == ["admin"]
    assert (await client.get(SETTINGS)).status_code == 200


async def test_wrong_confirmations_engage_the_sign_in_throttle(client, db, stored) -> None:
    for _ in range(5):
        assert (await client.post(REVEAL, json={"password": "not-my-password"})).status_code == 403

    throttled = await client.post(REVEAL, json={"password": TEST_PASSWORD})
    sign_in = await client.post(
        "/api/v1/auth/login", json={"username": "admin", "password": TEST_PASSWORD}
    )

    assert throttled.status_code == 429
    assert throttled.headers["retry-after"] == "60"
    assert sign_in.status_code == 429
    assert await _reveals(db) == []


async def test_nothing_to_reveal_without_a_stored_password(client, db, admin, key) -> None:
    response = await client.post(REVEAL, json={"password": TEST_PASSWORD})

    assert response.status_code == 404
    assert response.json()["detail"] == "Nie zapisano hasła WCO"
    assert await _reveals(db) == []


async def test_without_the_key_the_password_cannot_be_revealed(
    client, db, stored, monkeypatch
) -> None:
    monkeypatch.setattr(get_settings(), "secrets_key", None)

    response = await client.post(REVEAL, json={"password": TEST_PASSWORD})

    assert response.status_code == 409
    assert "ONCALL_SECRETS_KEY" in response.json()["detail"]
    assert await _reveals(db) == []


@pytest.mark.parametrize("pending", [False, True])
async def test_a_password_under_a_removed_key_cannot_be_revealed(
    client, db, stored, monkeypatch, pending
) -> None:
    if pending:
        other = Fernet(Fernet.generate_key()).encrypt(PENDING.encode()).decode()
        await db.execute(update(CallForwardingSettings).values(pending_password_ciphertext=other))
        await db.commit()
    else:
        monkeypatch.setattr(
            get_settings(), "secrets_key", SecretStr(Fernet.generate_key().decode())
        )

    response = await client.post(REVEAL, json={"password": TEST_PASSWORD})

    assert response.status_code == 409
    assert "Żaden klucz" in response.json()["detail"]
    assert PASSWORD not in response.text
    assert await _reveals(db) == []


async def _directory_admin(client, db, directory: FakeDirectory) -> None:
    """Anna signs in through the directory and is made an administrator."""
    use_directory(directory)
    signed_in = await client.post(
        "/api/v1/auth/login", json={"username": "anna", "password": DIRECTORY_PASSWORD}
    )
    assert signed_in.status_code == 200, signed_in.text
    client.headers["X-CSRF-Token"] = signed_in.headers["x-csrf-token"]
    await db.execute(update(User).where(User.username == "anna").values(role=UserRole.admin))
    await db.commit()
    saved = await client.put(SETTINGS, json={"mode": "off", "password": PASSWORD})
    assert saved.status_code == 200, saved.text


async def test_a_directory_administrator_confirms_with_the_directory(client, db, key) -> None:
    directory = FakeDirectory(directory_identity())
    await _directory_admin(client, db, directory)

    response = await client.post(REVEAL, json={"password": DIRECTORY_PASSWORD})

    assert response.status_code == 200, response.text
    assert response.json()["current"] == PASSWORD
    assert directory.calls[-1] == ("anna", DIRECTORY_PASSWORD)
    assert len(await _reveals(db)) == 1


@pytest.mark.parametrize(
    "identity",
    [None, directory_identity(personnel_number="000099")],
    ids=["refused", "another-person"],
)
async def test_a_directory_confirmation_must_name_the_same_account(
    client, db, key, identity
) -> None:
    directory = FakeDirectory(directory_identity())
    await _directory_admin(client, db, directory)
    directory.identity = identity

    response = await client.post(REVEAL, json={"password": DIRECTORY_PASSWORD})

    assert response.status_code == 403
    assert await _reveals(db) == []


async def test_a_directory_outage_is_answered_as_one(client, db, key) -> None:
    directory = FakeDirectory(directory_identity())
    await _directory_admin(client, db, directory)
    directory.error = DirectoryUnavailableError("timeout", phase="connect", reason="timeout")

    response = await client.post(REVEAL, json={"password": DIRECTORY_PASSWORD})

    assert response.status_code == 503
    assert await _reveals(db) == []
