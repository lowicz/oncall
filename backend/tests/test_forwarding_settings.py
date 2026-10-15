"""The administrator's settings of forwarding the on-call number through WCO,
and the state the forwarding pass leaves for them to read.

The WCO password is write-only: it goes in encrypted and never comes back
out, not in a response and not in the audit trail. Forwarding starts off and
is turned on only with a key to encrypt the password and everything a login
to WCO needs.
"""

from datetime import UTC, date, datetime

import pytest
from cryptography.fernet import Fernet
from pydantic import SecretStr
from sqlalchemy import select

from oncall import secrets
from oncall.config import get_settings
from oncall.domain.forwarding.models import ForwardingOutcome
from oncall.domain.vocabulary import UserRole
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.forwarding_models import (
    CallForwardingSettings,
    CallForwardingState,
)
from tests.conftest import create_user, login

SETTINGS = "/api/v1/admin/forwarding/settings"
STATE = "/api/v1/admin/forwarding/state"
#: A dummy WCO password; no test holds a real one.
PASSWORD = "Dummy-Haslo-WCO!1"
ACCOUNT = {"vpbx_number": "221234567", "username": "oncall-bot", "wco_user_id": "4711"}


@pytest.fixture
def key(monkeypatch: pytest.MonkeyPatch) -> str:
    value = Fernet.generate_key().decode()
    monkeypatch.setattr(get_settings(), "secrets_key", SecretStr(value))
    return value


@pytest.fixture
def no_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "secrets_key", None)


@pytest.fixture
async def admin(client, db) -> None:
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")


async def _audit(db) -> list[AuditEvent]:
    query = select(AuditEvent).where(AuditEvent.action.startswith("forwarding."))
    return list((await db.scalars(query.order_by(AuditEvent.occurred_at))).all())


async def _row(db) -> CallForwardingSettings:
    db.expire_all()
    return (await db.scalars(select(CallForwardingSettings))).one()


async def test_forwarding_starts_off_with_nothing_stored(client, admin) -> None:
    settings = await client.get(SETTINGS)
    state = await client.get(STATE)

    assert settings.status_code == 200, settings.text
    assert settings.json() | {"updated_at": None} == {
        "mode": "off",
        "base_url": "https://wco.orange.pl",
        "vpbx_number": None,
        "username": None,
        "wco_user_id": None,
        "password_set": False,
        "password_changed_at": None,
        "rotation_pending_since": None,
        "credentials_invalid_since": None,
        "updated_at": None,
    }
    assert state.status_code == 200, state.text
    assert state.json() == {
        "applied_number": None,
        "applied_member_name": None,
        "applied_at": None,
        "desired_number": None,
        "desired_member_name": None,
        "desired_for_day": None,
        "last_attempt_at": None,
        "last_outcome": None,
        "last_error": None,
        "failing_since": None,
        "attempts": 0,
        "next_attempt_at": None,
    }


@pytest.mark.parametrize("role", [UserRole.coordinator, UserRole.member])
async def test_only_an_administrator_reads_or_changes_forwarding(client, db, role) -> None:
    await create_user(db, "kasia", role=role)
    await login(client, "kasia")

    assert (await client.get(SETTINGS)).status_code == 403
    assert (await client.get(STATE)).status_code == 403
    assert (await client.put(SETTINGS, json={"mode": "off"})).status_code == 403


async def test_the_password_is_stored_encrypted_and_never_answered_or_audited(
    client, db, admin, key
) -> None:
    response = await client.put(SETTINGS, json={"mode": "live", **ACCOUNT, "password": PASSWORD})

    assert response.status_code == 200, response.text
    body = response.json()
    assert PASSWORD not in response.text
    assert body["mode"] == "live"
    assert body["password_set"] is True
    assert body["password_changed_at"] == body["updated_at"]
    assert {name: body[name] for name in ACCOUNT} == ACCOUNT
    assert PASSWORD not in (await client.get(SETTINGS)).text

    row = await _row(db)
    assert row.password_ciphertext is not None
    assert PASSWORD not in row.password_ciphertext
    assert secrets.decrypt(get_settings(), row.password_ciphertext) == PASSWORD

    [event] = await _audit(db)
    assert event.action == "forwarding.settings_updated"
    assert event.summary == "Przełączanie numeru: tryb live, nowe hasło WCO"
    assert event.details == {
        "mode": "live",
        "base_url": "https://wco.orange.pl",
        **ACCOUNT,
        "password_changed": True,
    }
    assert PASSWORD not in str(event.details)


async def test_saving_without_a_password_keeps_the_stored_one(client, db, admin, key) -> None:
    first = await client.put(SETTINGS, json={"mode": "off", **ACCOUNT, "password": PASSWORD})
    assert first.status_code == 200, first.text
    token = (await _row(db)).password_ciphertext

    second = await client.put(SETTINGS, json={"mode": "dry_run", **ACCOUNT, "password": None})

    assert second.status_code == 200, second.text
    assert second.json()["password_set"] is True
    assert (await _row(db)).password_ciphertext == token
    assert [event.summary for event in await _audit(db)] == [
        "Przełączanie numeru: tryb off, nowe hasło WCO",
        "Przełączanie numeru: tryb dry_run",
    ]


async def test_a_new_password_clears_a_half_done_rotation_and_a_refused_login(
    client, db, admin, key
) -> None:
    """An administrator's password is the one WCO holds: a pending password
    the pass generated and the stop after a refused login no longer apply."""
    await client.put(SETTINGS, json={"mode": "off"})
    row = await _row(db)
    row.pending_password_ciphertext = secrets.encrypt(get_settings(), "Dummy-Pending!2")
    row.pending_since = datetime(2026, 10, 1, 9, tzinfo=UTC)
    row.credentials_invalid_since = datetime(2026, 10, 1, 9, 5, tzinfo=UTC)
    await db.commit()
    pending = (await client.get(SETTINGS)).json()
    assert pending["rotation_pending_since"] is not None
    assert pending["credentials_invalid_since"] is not None

    response = await client.put(SETTINGS, json={"mode": "off", "password": PASSWORD})

    assert response.json()["rotation_pending_since"] is None
    assert response.json()["credentials_invalid_since"] is None
    row = await _row(db)
    assert row.pending_password_ciphertext is None
    assert row.pending_since is None


async def test_the_row_names_the_administrator_who_saved_it_last(client, db, admin) -> None:
    response = await client.put(SETTINGS, json={"mode": "off", **ACCOUNT})

    assert response.status_code == 200, response.text
    administrator = await db.scalar(select(User.id).where(User.username == "admin"))
    assert (await _row(db)).updated_by_user_id == administrator


async def test_a_new_address_keeps_no_stored_password(client, db, admin, key) -> None:
    """A stored password is sent only to the address it was entered for."""
    saved = await client.put(SETTINGS, json={"mode": "dry_run", **ACCOUNT, "password": PASSWORD})
    assert saved.status_code == 200, saved.text
    elsewhere = {"mode": "dry_run", **ACCOUNT, "base_url": "https://wco.example.test"}

    refused = await client.put(SETTINGS, json=elsewhere)

    assert refused.status_code == 422, refused.text
    assert "WCO" in refused.json()["detail"]
    assert (await client.get(SETTINGS)).json()["base_url"] == "https://wco.orange.pl"
    token = (await _row(db)).password_ciphertext
    assert secrets.decrypt(get_settings(), token) == PASSWORD
    assert len(await _audit(db)) == 1

    accepted = await client.put(SETTINGS, json=elsewhere | {"password": "Dummy-Nowe-WCO!3"})

    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["base_url"] == "https://wco.example.test"
    row = await _row(db)
    assert secrets.decrypt(get_settings(), row.password_ciphertext) == "Dummy-Nowe-WCO!3"


async def test_without_a_stored_password_the_address_changes_freely(client, admin) -> None:
    response = await client.put(
        SETTINGS, json={"mode": "off", "base_url": "https://wco.example.test"}
    )

    assert response.status_code == 200, response.text
    assert response.json()["base_url"] == "https://wco.example.test"


@pytest.mark.parametrize(
    "payload",
    [
        {"mode": "dry_run", **ACCOUNT, "password": PASSWORD},
        {"mode": "live", **ACCOUNT, "password": PASSWORD},
        {"mode": "off", "password": PASSWORD},
    ],
)
async def test_without_a_key_no_password_is_stored_and_forwarding_stays_off(
    client, db, admin, no_key, payload
) -> None:
    response = await client.put(SETTINGS, json=payload)

    assert response.status_code == 409, response.text
    assert "ONCALL_SECRETS_KEY" in response.json()["detail"]
    assert await _audit(db) == []
    assert (await client.get(SETTINGS)).json()["mode"] == "off"


async def test_without_a_key_the_rest_of_the_settings_can_still_be_saved(
    client, admin, no_key
) -> None:
    response = await client.put(SETTINGS, json={"mode": "off", **ACCOUNT})

    assert response.status_code == 200, response.text
    assert response.json()["vpbx_number"] == ACCOUNT["vpbx_number"]
    assert response.json()["password_set"] is False


@pytest.mark.parametrize(
    "payload",
    [
        {"mode": "live", **ACCOUNT},
        {"mode": "dry_run", **ACCOUNT, "username": None, "password": PASSWORD},
        {"mode": "live", **ACCOUNT, "wco_user_id": "  ", "password": PASSWORD},
    ],
)
async def test_forwarding_is_turned_on_only_with_everything_a_login_needs(
    client, admin, key, payload
) -> None:
    response = await client.put(SETTINGS, json=payload)

    assert response.status_code == 422, response.text
    assert "WCO" in response.json()["detail"]


@pytest.mark.parametrize(
    "payload",
    [
        {"mode": "off", "base_url": "http://wco.orange.pl"},
        {"mode": "off", "base_url": "https://wco orange.pl"},
        {"mode": "off", "password": ""},
        {"mode": "on"},
        {"mode": "off", "password_ciphertext": "x"},
    ],
)
async def test_a_malformed_form_is_refused(client, admin, key, payload) -> None:
    assert (await client.put(SETTINGS, json=payload)).status_code == 422


async def test_blank_fields_are_stored_as_unset(client, admin) -> None:
    response = await client.put(
        SETTINGS,
        json={"mode": "off", "vpbx_number": " ", "username": "", "wco_user_id": " 4711 "},
    )

    assert response.status_code == 200, response.text
    assert response.json()["vpbx_number"] is None
    assert response.json()["username"] is None
    assert response.json()["wco_user_id"] == "4711"


async def test_the_state_shows_what_the_last_pass_left_and_not_its_bookkeeping(
    client, db, admin
) -> None:
    db.add(
        CallForwardingState(
            applied_number="+48500500500",
            applied_member_name="Anna Kowalska",
            applied_at=datetime(2026, 10, 14, 7, 0, 5, tzinfo=UTC),
            desired_number="+48600600600",
            desired_member_name="Marek Nowak",
            desired_for_day=date(2026, 10, 15),
            last_attempt_at=datetime(2026, 10, 15, 7, 0, 5, tzinfo=UTC),
            last_outcome=ForwardingOutcome.failed,
            last_error="PUT functionalities/user: 500",
            failing_since=datetime(2026, 10, 15, 7, 0, 5, tzinfo=UTC),
            attempts=2,
            next_attempt_at=datetime(2026, 10, 15, 7, 4, 5, tzinfo=UTC),
            lease_until=datetime(2026, 10, 15, 7, 2, 5, tzinfo=UTC),
            alerted_for="forwarding-failed:2026-10-15:+48600600600",
        )
    )
    await db.commit()

    state = (await client.get(STATE)).json()

    assert state["applied_number"] == "+48500500500"
    assert state["desired_member_name"] == "Marek Nowak"
    assert state["desired_for_day"] == "2026-10-15"
    assert state["last_outcome"] == "failed"
    assert state["attempts"] == 2
    assert "lease_until" not in state
    assert "alerted_for" not in state
