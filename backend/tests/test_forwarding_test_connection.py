"""An administrator checking the connection to WCO from the forwarding
screen: one login with the stored settings, the way the forwarding pass does
it, and one read of the number WCO forwards to. Nothing is written to WCO,
whatever WCO answers is an outcome rather than an error, every test lands in
the audit trail, and no password or WCO response body reaches the answer or
a log.
"""

import logging
import ssl

import httpx
import pytest
from cryptography.fernet import Fernet
from pydantic import SecretStr
from sqlalchemy import select, update

from oncall import secrets
from oncall.config import get_settings
from oncall.domain.vocabulary import UserRole
from oncall.infrastructure import wco_probe
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.forwarding_models import CallForwardingSettings
from oncall.wco import WcoClient
from tests.conftest import create_user, login
from tests.smtp_relay import private_ca
from tests.wco_fake import BASE_URL, LOGIN, PERFORM_LOGIN, USER, FakeWco, https_wco

SETTINGS = "/api/v1/admin/forwarding/settings"
TEST = "/api/v1/admin/forwarding/test"
#: Dummy WCO passwords; no test holds a real one.
PASSWORD = "Dummy-Passw0rd!"
PENDING = "Dummy-Pending-WCO!2"


@pytest.fixture
def key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "secrets_key", SecretStr(Fernet.generate_key().decode()))


@pytest.fixture
async def admin(client, db) -> None:
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch) -> FakeWco:
    wco = FakeWco()
    monkeypatch.setattr(
        wco_probe,
        "_open_wco",
        lambda base_url: WcoClient(
            base_url, verify=ssl.create_default_context(), transport=wco.transport()
        ),
    )
    return wco


@pytest.fixture
async def stored(client, admin, key, fake: FakeWco) -> None:
    """The settings of the fake WCO's account, saved by the administrator."""
    response = await client.put(
        SETTINGS,
        json={
            "mode": "off",
            "base_url": BASE_URL,
            "vpbx_number": fake.vpbx_number,
            "username": fake.username,
            "wco_user_id": fake.user_id,
            "password": PASSWORD,
        },
    )
    assert response.status_code == 200, response.text


async def _tests(db) -> list[AuditEvent]:
    query = select(AuditEvent).where(AuditEvent.action == "forwarding.test")
    return list((await db.scalars(query)).all())


async def _stage_pending(db) -> None:
    await db.execute(
        update(CallForwardingSettings).values(
            pending_password_ciphertext=secrets.encrypt(get_settings(), PENDING)
        )
    )
    await db.commit()


async def test_a_working_connection_answers_the_number_wco_forwards_to(
    client, db, stored, fake: FakeWco, caplog
) -> None:
    caplog.set_level(logging.DEBUG)

    response = await client.post(TEST)

    assert response.status_code == 200, response.text
    assert response.json() == {"outcome": "ok", "number": "+48600600600", "detail": None}
    assert fake.calls == [f"GET {LOGIN}", f"POST {PERFORM_LOGIN}", f"GET {USER}/{fake.user_id}"]
    administrator = await db.scalar(select(User.id).where(User.username == "admin"))
    [event] = await _tests(db)
    assert event.actor_user_id == administrator
    assert event.summary == "Sprawdzono połączenie z WCO: połączenie działa"
    assert event.details == {"outcome": "ok", "number": "+48600600600", "detail": None}
    assert PASSWORD not in caplog.text
    assert PASSWORD not in response.text


async def test_a_user_without_a_number_is_still_a_working_connection(
    client, stored, fake: FakeWco
) -> None:
    fake.user["number"] = None

    response = await client.post(TEST)

    assert response.json() == {"outcome": "ok", "number": None, "detail": None}


async def test_a_pending_password_is_tried_first_as_the_worker_does(
    client, db, stored, fake: FakeWco
) -> None:
    await _stage_pending(db)
    fake.password = PENDING

    response = await client.post(TEST)

    assert response.json()["outcome"] == "ok"
    assert [body["password"] for body in fake.bodies(PERFORM_LOGIN)] == [PENDING]


async def test_every_stored_password_refused_is_an_outcome_not_an_error(
    client, db, stored, fake: FakeWco
) -> None:
    await _stage_pending(db)
    fake.password = "Dummy-Changed-Elsewhere!3"

    response = await client.post(TEST)

    assert response.status_code == 200
    assert response.json() == {"outcome": "login_refused", "number": None, "detail": None}
    assert [body["password"] for body in fake.bodies(PERFORM_LOGIN)] == [PENDING, PASSWORD]
    [event] = await _tests(db)
    assert event.summary == "Sprawdzono połączenie z WCO: WCO odrzuciło dane logowania"
    assert PASSWORD not in str(event.details) and PENDING not in str(event.details)


async def test_an_expired_password_is_reported_and_left_for_the_worker(
    client, db, stored, fake: FakeWco
) -> None:
    fake.password_expired = True

    response = await client.post(TEST)

    assert response.json() == {"outcome": "password_expired", "number": None, "detail": None}
    assert fake.password == PASSWORD
    assert f"POST {PERFORM_LOGIN}" in fake.calls
    assert not any(call.startswith("PUT") or "change-password" in call for call in fake.calls)
    [event] = await _tests(db)
    assert event.summary == "Sprawdzono połączenie z WCO: hasło WCO wygasło"


@pytest.mark.parametrize(
    ("fault", "detail"),
    [
        (httpx.ConnectError("boom"), f"GET {LOGIN} failed: ConnectError: boom"),
        (500, f"GET {LOGIN} answered HTTP 500"),
    ],
    ids=["network", "server-error"],
)
async def test_a_failed_call_names_the_call_and_never_the_body(
    client, db, stored, fake: FakeWco, fault, detail
) -> None:
    fake.faults[LOGIN] = fault

    response = await client.post(TEST)

    assert response.json() == {"outcome": "connection", "number": None, "detail": detail}
    assert PASSWORD not in response.text
    [event] = await _tests(db)
    assert event.summary == "Sprawdzono połączenie z WCO: nie udało się połączyć z WCO"
    assert event.details["detail"] == detail


async def test_the_test_verifies_wco_against_the_deployment_ca_file(
    client, db, admin, key, monkeypatch, tmp_path
) -> None:
    """The real client path: a WCO on the loopback behind a private CA opens
    a session only once `ONCALL_CA_FILE` names that CA; it then answers the
    user call with no object, which is a connection outcome."""
    bundle, server_tls = private_ca(tmp_path)
    account = {"vpbx_number": "221234567", "username": "oncall", "wco_user_id": "1001"}
    with https_wco(server_tls) as base_url:
        saved = await client.put(
            SETTINGS, json={**account, "base_url": base_url, "password": PASSWORD}
        )
        assert saved.status_code == 200, saved.text
        monkeypatch.setattr(get_settings(), "ca_file", None)
        untrusted = (await client.post(TEST)).json()
        monkeypatch.setattr(get_settings(), "ca_file", str(bundle))
        trusted = (await client.post(TEST)).json()

    assert untrusted["outcome"] == "connection"
    assert "CERTIFICATE_VERIFY_FAILED" in untrusted["detail"]
    assert trusted == {
        "outcome": "connection",
        "number": None,
        "detail": f"GET {USER}/1001 answered no user object",
    }
    assert len(await _tests(db)) == 2


async def test_an_unreadable_ca_file_is_a_configuration_outcome(
    client, db, admin, key, monkeypatch
) -> None:
    account = {"vpbx_number": "221234567", "username": "oncall", "wco_user_id": "1001"}
    saved = await client.put(SETTINGS, json={**account, "password": PASSWORD})
    assert saved.status_code == 200, saved.text
    monkeypatch.setattr(get_settings(), "ca_file", "/missing/ca.pem")

    response = await client.post(TEST)

    body = response.json()
    assert body["outcome"] == "configuration"
    assert body["number"] is None
    assert "ONCALL_CA_FILE is unreadable (/missing/ca.pem)" in body["detail"]
    [event] = await _tests(db)
    assert event.summary == "Sprawdzono połączenie z WCO: konfiguracja WCO jest niedostępna"


@pytest.mark.parametrize(
    "saved",
    [
        {"password": PASSWORD, "username": "oncall", "wco_user_id": "1001"},
        {"vpbx_number": "221234567", "username": "oncall", "wco_user_id": "1001"},
    ],
    ids=["no-switchboard-number", "no-password"],
)
async def test_incomplete_settings_are_refused_before_any_call(
    client, db, admin, key, fake: FakeWco, saved
) -> None:
    assert (await client.put(SETTINGS, json=saved)).status_code == 200

    response = await client.post(TEST)

    assert response.status_code == 422
    assert response.json()["detail"].startswith("Aby włączyć przełączanie, podaj")
    assert fake.calls == []
    assert await _tests(db) == []


async def test_without_the_key_nothing_is_tried(
    client, db, stored, fake: FakeWco, monkeypatch
) -> None:
    monkeypatch.setattr(get_settings(), "secrets_key", None)

    response = await client.post(TEST)

    assert response.status_code == 409
    assert "ONCALL_SECRETS_KEY" in response.json()["detail"]
    assert fake.calls == []
    assert await _tests(db) == []


async def test_a_password_under_a_removed_key_cannot_be_tried(
    client, db, stored, fake: FakeWco, monkeypatch
) -> None:
    monkeypatch.setattr(get_settings(), "secrets_key", SecretStr(Fernet.generate_key().decode()))

    response = await client.post(TEST)

    assert response.status_code == 409
    assert "Żaden klucz" in response.json()["detail"]
    assert fake.calls == []
    assert await _tests(db) == []


@pytest.mark.parametrize("role", [UserRole.coordinator, UserRole.member])
async def test_only_an_administrator_may_test(client, db, role, fake: FakeWco) -> None:
    await create_user(db, "kasia", role=role)
    await login(client, "kasia")

    assert (await client.post(TEST)).status_code == 403
    assert fake.calls == []


async def test_a_test_needs_the_csrf_token(client, db, stored, fake: FakeWco) -> None:
    del client.headers["X-CSRF-Token"]

    assert (await client.post(TEST)).status_code == 403
    assert fake.calls == []
