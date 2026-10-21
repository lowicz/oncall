"""The two single sign-on routes against a fake provider client: the cookie
and the redirect to the provider, the callback's checks, the session it
opens, and what each refusal leaves in the audit trail and the log."""

import base64
import json
import logging
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

import pytest
from sqlalchemy import select

from oncall.config import Settings
from oncall.domain.vocabulary import AuthSource
from oncall.infrastructure.sqlalchemy.access_models import Session, User
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.main import app
from oncall.routes import access, system
from oncall.sso_auth import (
    SsoRejectedError,
    SsoUnavailableError,
    code_challenge,
    get_sso_client,
)
from tests.conftest import create_user
from tests.test_ldap_client import records

START = "/api/v1/auth/sso/start"
CALLBACK = "/api/v1/auth/sso/callback"
PROVIDER = "https://sso.example/realms/firma/protocol/openid-connect/auth"
CODE = "code-1a2b3c"


class FakeSso:
    def __init__(self) -> None:
        self.number = "000042"
        self.failure: Exception | None = None
        self.started: list[dict[str, str]] = []
        self.exchanged: list[dict[str, str]] = []

    async def authorization_url(self, *, state: str, nonce: str, code_verifier: str) -> str:
        if self.failure is not None:
            raise self.failure
        self.started.append({"state": state, "nonce": nonce, "code_verifier": code_verifier})
        challenge = code_challenge(code_verifier)
        return f"{PROVIDER}?state={state}&nonce={nonce}&code_challenge={challenge}"

    async def exchange(self, code: str, *, code_verifier: str, nonce: str) -> str:
        self.exchanged.append({"code": code, "code_verifier": code_verifier, "nonce": nonce})
        if self.failure is not None:
            raise self.failure
        return self.number


def sso_settings(**changes) -> Settings:
    return Settings(
        sso_enabled=True,
        sso_issuer="https://sso.example/realms/firma",
        sso_client_id="oncall",
        **changes,
    )


@pytest.fixture
def sso(monkeypatch: pytest.MonkeyPatch) -> FakeSso:
    fake = FakeSso()
    monkeypatch.setattr(access, "get_settings", sso_settings)
    monkeypatch.setattr(system, "get_settings", sso_settings)
    app.dependency_overrides[get_sso_client] = lambda: fake
    return fake


@pytest.fixture
def diagnostics(caplog):
    caplog.set_level(logging.INFO, logger="oncall")
    yield caplog
    assert CODE not in caplog.text


def pending_from(response) -> dict[str, str]:
    return json.loads(base64.urlsafe_b64decode(response.cookies["oncall_sso"]))


def set_cookies(response) -> list[str]:
    return response.headers.get_list("set-cookie")


async def start(client, **params):
    response = await client.get(START, params=params)
    assert response.status_code == 302, response.text
    return response


async def callback(client, state: str | None, **params):
    query = {"code": CODE, "state": state} | params
    return await client.get(CALLBACK, params={k: v for k, v in query.items() if v is not None})


async def signed_in(client, **params):
    pending = pending_from(await start(client, **params))
    return await callback(client, pending["state"]), pending


async def account_with_number(db, username: str, number: str, **changes) -> User:
    user = await create_user(db, username)
    user.personnel_number = number
    for field, value in changes.items():
        setattr(user, field, value)
    await db.commit()
    return user


async def audit(db, action: str) -> list[AuditEvent]:
    return list(await db.scalars(select(AuditEvent).where(AuditEvent.action == action)))


async def test_start_sends_the_browser_to_the_provider_with_what_the_cookie_holds(
    client, sso, diagnostics
) -> None:
    response = await start(client, next="/zamiany?okres=2026-10")

    pending = pending_from(response)
    location = urlsplit(response.headers["location"])
    assert f"{location.scheme}://{location.netloc}{location.path}" == PROVIDER
    assert {name: values[0] for name, values in parse_qs(location.query).items()} == {
        "state": pending["state"],
        "nonce": pending["nonce"],
        "code_challenge": code_challenge(pending["verifier"]),
    }
    assert pending["next"] == "/zamiany?okres=2026-10"
    assert len({pending["state"], pending["nonce"], pending["verifier"]}) == 3
    assert all(len(value) >= 43 for value in sso.started[0].values())
    [cookie] = set_cookies(response)
    assert cookie.startswith("oncall_sso=")
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    assert "Secure" not in cookie
    assert "Max-Age=600" in cookie
    assert "Path=/api/v1/auth/sso" in cookie
    assert response.headers["cache-control"] == "no-store"
    assert records(diagnostics) == []


async def test_the_sso_cookie_is_secure_when_the_session_cookie_is(
    client, sso, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        access,
        "get_settings",
        lambda: sso_settings(session_cookie_secure=True, public_base_url="https://oncall.example"),
    )

    [cookie] = set_cookies(await start(client))

    assert "Secure" in cookie


async def test_two_starts_remember_different_secrets(client, sso) -> None:
    first = pending_from(await start(client))
    second = pending_from(await start(client))

    assert first["state"] != second["state"]
    assert first["verifier"] != second["verifier"]


@pytest.mark.parametrize(
    "unsafe",
    ["//evil.example/x", "https://evil.example/x", "/\\evil.example", "zamiany", "", "/a\nb"],
)
async def test_a_return_address_off_this_origin_becomes_the_front_page(client, sso, unsafe) -> None:
    assert pending_from(await start(client, next=unsafe))["next"] == "/"


async def test_the_callback_opens_a_session_and_returns_to_the_screen(
    client, db, sso, diagnostics
) -> None:
    anna = await account_with_number(db, "anna", "000042")

    response, pending = await signed_in(client, next="/zamiany")

    assert (response.status_code, response.headers["location"]) == (302, "/zamiany")
    assert response.headers["cache-control"] == "no-store"
    cookies = set_cookies(response)
    assert any(c.startswith("oncall_session=") and "HttpOnly" in c for c in cookies)
    assert any(c.startswith('oncall_sso=""') and "Max-Age=0" in c for c in cookies)
    assert sso.exchanged == [
        {"code": CODE, "code_verifier": pending["verifier"], "nonce": pending["nonce"]}
    ]
    me = await client.get("/api/v1/auth/me")
    assert (me.status_code, me.json()["username"]) == (200, "anna")
    [login] = await audit(db, "auth.login")
    assert (login.actor_user_id, login.details) == (anna.id, {"via": "sso"})
    await db.refresh(anna)
    assert anna.auth_source == AuthSource.local
    assert anna.password_hash is not None
    [record] = records(diagnostics)
    assert record | {"event": "login", "outcome": "signed_in", "source": "sso"} == record
    assert record["login"] == "anna"


async def test_a_directory_account_signs_in_and_stays_a_directory_account(client, db, sso) -> None:
    anna = await account_with_number(
        db, "anna", "000042", auth_source=AuthSource.ldap, password_hash=None
    )

    response, _ = await signed_in(client)

    assert response.headers["location"] == "/"
    await db.refresh(anna)
    assert (anna.auth_source, anna.password_hash) == (AuthSource.ldap, None)
    assert [row.action for row in await db.scalars(select(AuditEvent))] == ["auth.login"]


async def test_no_account_with_the_number_is_refused_and_the_number_recorded(
    client, db, sso, diagnostics
) -> None:
    await account_with_number(db, "anna", "000043")

    response, _ = await signed_in(client, next="/zamiany")

    assert (response.status_code, response.headers["location"]) == (302, "/?sso=no_account")
    assert not any(c.startswith("oncall_session=") for c in set_cookies(response))
    assert await db.scalar(select(Session)) is None
    [refused] = await audit(db, "auth.sso_rejected")
    assert (refused.actor_label, refused.summary, refused.details) == (
        "000042",
        "Odrzucono logowanie SSO",
        {"phase": "account", "reason": "no_account"},
    )
    [record] = records(diagnostics)
    assert (record["event"], record["outcome"], record["phase"], record["reason"]) == (
        "sso_auth",
        "rejected",
        "account",
        "no_account",
    )
    assert record["number"] == "000042"


async def test_an_inactive_account_is_refused(client, db, sso) -> None:
    await account_with_number(db, "anna", "000042", is_active=False)

    response, _ = await signed_in(client)

    assert response.headers["location"] == "/?sso=inactive"
    [refused] = await audit(db, "auth.sso_rejected")
    assert refused.details == {"phase": "account", "reason": "account_inactive"}


def callback_refusal(diagnostics) -> tuple[str, str, str, str]:
    [record] = records(diagnostics)
    return (record["event"], record["outcome"], record["phase"], record["reason"])


async def test_a_callback_without_the_cookie_is_logged_but_not_audited(
    client, db, sso, diagnostics
) -> None:
    response = await callback(client, "state-1")

    assert (response.status_code, response.headers["location"]) == (302, "/?sso=rejected")
    assert sso.exchanged == []
    assert list(await db.scalars(select(AuditEvent))) == []
    assert callback_refusal(diagnostics) == ("sso_auth", "rejected", "callback", "state_mismatch")


@pytest.mark.parametrize("state", ["state-of-another-browser", "", None])
async def test_a_state_that_is_not_the_cookies_is_refused(
    client, db, sso, diagnostics, state
) -> None:
    await start(client)

    response = await callback(client, state)

    assert response.headers["location"] == "/?sso=rejected"
    assert sso.exchanged == []
    assert list(await db.scalars(select(AuditEvent))) == []
    assert callback_refusal(diagnostics)[3] == "state_mismatch"


async def test_a_cookie_that_is_not_ours_is_refused(client, db, sso, diagnostics) -> None:
    client.cookies.set("oncall_sso", "not-what-we-set", domain="test", path="/api/v1/auth/sso")

    response = await callback(client, "state-1")

    assert response.headers["location"] == "/?sso=rejected"
    assert list(await db.scalars(select(AuditEvent))) == []
    assert callback_refusal(diagnostics)[3] == "state_mismatch"


async def test_the_providers_refusal_is_logged_under_one_fixed_code(
    client, db, sso, diagnostics
) -> None:
    pending = pending_from(await start(client))

    response = await callback(client, pending["state"], error="<script>" + "x" * 200)

    assert response.headers["location"] == "/?sso=rejected"
    assert sso.exchanged == []
    assert list(await db.scalars(select(AuditEvent))) == []
    assert callback_refusal(diagnostics) == ("sso_auth", "rejected", "callback", "provider_error")
    assert "<script>" not in diagnostics.text


async def test_a_callback_without_a_code_is_refused(client, db, sso, diagnostics) -> None:
    pending = pending_from(await start(client))

    response = await callback(client, pending["state"], code=None)

    assert response.headers["location"] == "/?sso=rejected"
    assert list(await db.scalars(select(AuditEvent))) == []
    assert callback_refusal(diagnostics)[3] == "code_missing"


async def test_a_provider_down_at_start_sends_the_person_to_the_password_form(
    client, db, sso
) -> None:
    sso.failure = SsoUnavailableError("discovery", "timeout")

    response = await start(client)

    assert response.headers["location"] == "/?sso=unavailable"
    assert not any(
        c.startswith("oncall_sso=") and "Max-Age=600" in c for c in set_cookies(response)
    )
    [outage] = await audit(db, "auth.sso_unavailable")
    assert (outage.actor_label, outage.summary, outage.details) == (
        "sso",
        "SSO niedostępne",
        {"phase": "discovery", "reason": "timeout", "count": 1},
    )


async def test_outages_within_five_minutes_share_one_audit_row(client, db, sso) -> None:
    sso.failure = SsoUnavailableError("discovery", "timeout")
    await start(client)
    sso.failure = SsoUnavailableError("discovery", "connection_refused")
    await start(client)

    [outage] = await audit(db, "auth.sso_unavailable")
    assert outage.details == {"phase": "discovery", "reason": "connection_refused", "count": 2}

    outage.occurred_at -= timedelta(minutes=6)
    await db.commit()
    await start(client)

    assert len(await audit(db, "auth.sso_unavailable")) == 2


async def test_a_provider_down_at_the_exchange_sends_the_person_to_the_password_form(
    client, db, sso
) -> None:
    pending = pending_from(await start(client))
    sso.failure = SsoUnavailableError("exchange", "connection_refused")

    response = await callback(client, pending["state"])

    assert response.headers["location"] == "/?sso=unavailable"
    assert await db.scalar(select(Session)) is None
    [outage] = await audit(db, "auth.sso_unavailable")
    assert outage.details == {"phase": "exchange", "reason": "connection_refused", "count": 1}


async def test_a_rejected_token_sends_the_person_back(client, db, sso) -> None:
    pending = pending_from(await start(client))
    sso.failure = SsoRejectedError("verify", "nonce_mismatch")

    response = await callback(client, pending["state"])

    assert response.headers["location"] == "/?sso=rejected"
    [refused] = await audit(db, "auth.sso_rejected")
    assert (refused.actor_label, refused.details) == (
        "sso",
        {"phase": "verify", "reason": "nonce_mismatch"},
    )


@pytest.mark.parametrize("path", [START, CALLBACK])
async def test_the_routes_do_not_exist_while_sso_is_off(client, path) -> None:
    response = await client.get(path, params={"state": "x", "code": "y"})

    assert (response.status_code, response.json()) == (
        404,
        {"detail": "Logowanie SSO jest wyłączone"},
    )
    english = await client.get(path, headers={"Accept-Language": "en"})
    assert english.json() == {"detail": "SSO sign-in is turned off"}


async def test_the_public_config_says_whether_sso_is_on(client, sso) -> None:
    response = await client.get("/api/v1/config")

    assert response.json()["sso_enabled"] is True
