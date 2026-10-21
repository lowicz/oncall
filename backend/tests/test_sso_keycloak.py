"""Single sign-on against a real Keycloak: the realm docker-compose.keycloak.yml
imports (examples/keycloak/realm-oncall.json), the API in process, and two
cookie-keeping HTTP clients in place of the browser, one for each site, the
Keycloak one filling in Keycloak's own login form.

Skipped unless ``ONCALL_E2E_KEYCLOAK_URL`` names that Keycloak, e.g.
``http://localhost:8180``; the CI job ``sso-keycloak`` runs it.
"""

import html
import os
import re
from collections.abc import AsyncIterator

import httpx
import pytest

from oncall.config import Settings
from oncall.main import app
from oncall.routes import access
from oncall.sso_auth import OidcClient, get_sso_client
from tests.test_sso_auth import account_with_number, audit

KEYCLOAK_URL = os.environ.get("ONCALL_E2E_KEYCLOAK_URL", "")
pytestmark = pytest.mark.skipif(not KEYCLOAK_URL, reason="ONCALL_E2E_KEYCLOAK_URL is not set")

#: The API's address as the realm's client knows it: Keycloak sends the
#: browser back to this one only.
API = "http://localhost:8000"
CALLBACK = f"{API}/api/v1/auth/sso/callback?"
LOGIN_FORM = re.compile(r'<form id="kc-form-login"[^>]*\saction="([^"]+)"')


@pytest.fixture
async def keycloak(monkeypatch: pytest.MonkeyPatch) -> AsyncIterator[httpx.AsyncClient]:
    """The browser's side of Keycloak, with the API's SSO pointed at it."""
    settings = Settings(
        sso_enabled=True,
        sso_issuer=f"{KEYCLOAK_URL}/realms/oncall",
        sso_client_id="oncall",
        public_base_url=API,
    )
    sso = OidcClient(settings)
    monkeypatch.setattr(access, "get_settings", lambda: settings)
    app.dependency_overrides[get_sso_client] = lambda: sso
    async with httpx.AsyncClient() as browser:
        yield browser


async def sign_in(client, keycloak, username: str, **params) -> httpx.Response:
    """Press "Zaloguj przez SSO", sign in at Keycloak as `username` and
    return the API's answer to Keycloak sending the browser back."""
    to_keycloak = await client.get("/api/v1/auth/sso/start", params=params)
    assert to_keycloak.status_code == 302, to_keycloak.text
    page = await keycloak.get(to_keycloak.headers["location"])
    # Keycloak marks its cookies `Secure` and `Version=1` over plain HTTP
    # too. A browser sends them back to http://localhost all the same;
    # http.cookiejar does only once they are plain cookies.
    for cookie in keycloak.cookies.jar:
        cookie.secure, cookie.version = False, 0
    form = LOGIN_FORM.search(page.text)
    assert form, page.text
    back = await keycloak.post(
        html.unescape(form[1]), data={"username": username, "password": f"{username}-haslo"}
    )
    assert back.status_code == 302, back.text
    assert back.headers["location"].startswith(CALLBACK)
    return await client.get(back.headers["location"].removeprefix(API))


async def test_a_keycloak_user_signs_in_to_the_account_with_their_number(
    client, db, keycloak
) -> None:
    anna = await account_with_number(db, "anna", "000042")

    response = await sign_in(client, keycloak, "anna", next="/zamiany")

    assert (response.status_code, response.headers["location"]) == (302, "/zamiany")
    assert client.cookies.get("oncall_session")
    assert "oncall_sso" not in client.cookies
    me = await client.get("/api/v1/auth/me")
    assert (me.status_code, me.json()["username"]) == (200, "anna")
    [login] = await audit(db, "auth.login")
    assert (login.actor_user_id, login.details) == (anna.id, {"via": "sso"})


@pytest.mark.parametrize(
    ("username", "code", "reason"),
    [("bez-konta", "no_account", "no_account"), ("wylaczona", "inactive", "account_inactive")],
)
async def test_a_keycloak_user_without_an_active_account_is_refused(
    client, db, keycloak, username: str, code: str, reason: str
) -> None:
    await account_with_number(db, "ewa", "000043", is_active=False)

    response = await sign_in(client, keycloak, username)

    assert (response.status_code, response.headers["location"]) == (302, f"/?sso={code}")
    assert (await client.get("/api/v1/auth/me")).status_code == 401
    [refused] = await audit(db, "auth.sso_rejected")
    assert refused.details == {"phase": "account", "reason": reason}
