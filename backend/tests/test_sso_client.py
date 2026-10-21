"""The OpenID Connect client against a fake provider: discovery, the code
exchange, every check an ID token has to pass, and what the log says - and
never says - when a conversation ends without a personnel number."""

import logging
import time
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from jwt.algorithms import RSAAlgorithm

from oncall.config import Settings, get_settings
from oncall.sso_auth import (
    OidcClient,
    SsoRejectedError,
    SsoUnavailableError,
    code_challenge,
    get_sso_client,
)
from tests.smtp_relay import private_ca
from tests.test_ldap_client import records

ISSUER = "https://sso.example/realms/firma"
CLIENT_ID = "oncall"
DISCOVERY_URL = f"{ISSUER}/.well-known/openid-configuration"
AUTH_URL = f"{ISSUER}/protocol/openid-connect/auth"
TOKEN_URL = f"{ISSUER}/protocol/openid-connect/token"
JWKS_URL = f"{ISSUER}/protocol/openid-connect/certs"
NONCE = "nonce-7f3a2c"
VERIFIER = "verifier-" + "k" * 40
CODE = "code-9c1d4e"


@pytest.fixture(scope="module")
def signing_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(65537, 2048)


@pytest.fixture(scope="module")
def other_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(65537, 2048)


class FakeProvider:
    """Keycloak as the client sees it: discovery, the token endpoint and the
    JWK set, each answer replaceable, the whole transport breakable."""

    def __init__(self, private_key: rsa.RSAPrivateKey) -> None:
        self.private_key = private_key
        self.kid = "key-1"
        self.calls: list[str] = []
        self.exchanges: list[dict[str, str]] = []
        self.answers: dict[str, httpx.Response] = {}
        self.failure: Exception | None = None
        self.token: str | None = None

    def jwks(self) -> dict:
        public = RSAAlgorithm.to_jwk(self.private_key.public_key(), as_dict=True)
        return {"keys": [public | {"kid": self.kid, "alg": "RS256", "use": "sig"}]}

    def id_token(self, *, key=None, kid: str | None = None, algorithm="RS256", **claims) -> str:
        """A good token unless `claims` says otherwise; None drops a claim."""
        now = int(time.time())
        payload = {
            "iss": ISSUER,
            "aud": CLIENT_ID,
            "azp": CLIENT_ID,
            "sub": "anna",
            "exp": now + 300,
            "iat": now,
            "nonce": NONCE,
            "employeeNumber": "000042",
        } | claims
        return jwt.encode(
            {name: value for name, value in payload.items() if value is not None},
            key or self.private_key,
            algorithm=algorithm,
            headers={"kid": kid or self.kid},
        )

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.calls.append(f"{request.method} {url}")
        if self.failure is not None:
            raise self.failure
        if url in self.answers:
            return self.answers[url]
        if url == DISCOVERY_URL:
            return httpx.Response(
                200,
                json={
                    "issuer": ISSUER,
                    "authorization_endpoint": AUTH_URL,
                    "token_endpoint": TOKEN_URL,
                    "jwks_uri": JWKS_URL,
                },
            )
        if url == JWKS_URL:
            return httpx.Response(200, json=self.jwks())
        if url == TOKEN_URL:
            self.exchanges.append(
                {name: values[0] for name, values in parse_qs(request.content.decode()).items()}
            )
            return httpx.Response(
                200,
                json={
                    "access_token": "access-1",
                    "token_type": "Bearer",
                    "id_token": self.token or self.id_token(),
                },
            )
        return httpx.Response(404)


def client(provider: FakeProvider, **settings) -> OidcClient:
    return OidcClient(
        Settings(sso_enabled=True, sso_issuer=ISSUER, sso_client_id=CLIENT_ID, **settings),
        transport=httpx.MockTransport(provider.handler),
    )


async def exchange(oidc: OidcClient) -> str:
    return await oidc.exchange(CODE, code_verifier=VERIFIER, nonce=NONCE)


async def authorization_url(oidc: OidcClient) -> str:
    return await oidc.authorization_url(state="state-1", nonce=NONCE, code_verifier=VERIFIER)


@pytest.fixture
def provider(signing_key) -> FakeProvider:
    return FakeProvider(signing_key)


@pytest.fixture
def diagnostics(caplog):
    caplog.set_level(logging.INFO, logger="oncall")
    yield caplog
    assert CODE not in caplog.text
    assert VERIFIER not in caplog.text
    assert "eyJ" not in caplog.text, "a token reached the log"


async def test_the_browser_is_sent_to_the_provider_with_the_pkce_challenge(
    provider, diagnostics
) -> None:
    oidc = client(provider)

    url = await authorization_url(oidc)
    again = await authorization_url(oidc)

    parts = urlsplit(url)
    assert f"{parts.scheme}://{parts.netloc}{parts.path}" == AUTH_URL
    assert {name: values[0] for name, values in parse_qs(parts.query).items()} == {
        "response_type": "code",
        "client_id": CLIENT_ID,
        "redirect_uri": "http://localhost:8080/api/v1/auth/sso/callback",
        "scope": "openid",
        "state": "state-1",
        "nonce": NONCE,
        "code_challenge": code_challenge(VERIFIER),
        "code_challenge_method": "S256",
    }
    assert again == url
    assert provider.calls == [f"GET {DISCOVERY_URL}"], "discovery is read once per process"
    assert records(diagnostics) == []


def test_the_redirect_uri_is_the_public_base_url_plus_the_callback_path(provider) -> None:
    oidc = client(
        provider, public_base_url="https://oncall.example:8443/", session_cookie_secure=True
    )

    assert oidc.redirect_uri == "https://oncall.example:8443/api/v1/auth/sso/callback"


async def test_an_authorization_endpoint_with_a_query_keeps_it(provider) -> None:
    provider.answers[DISCOVERY_URL] = httpx.Response(
        200,
        json={
            "authorization_endpoint": f"{AUTH_URL}?tenant=firma",
            "token_endpoint": TOKEN_URL,
            "jwks_uri": JWKS_URL,
        },
    )

    url = await authorization_url(client(provider))

    assert url.startswith(f"{AUTH_URL}?tenant=firma&response_type=code&")


async def test_an_issuer_configured_with_a_trailing_slash_matches_the_tokens(provider) -> None:
    oidc = OidcClient(
        Settings(sso_enabled=True, sso_issuer=f"{ISSUER}/", sso_client_id=CLIENT_ID),
        transport=httpx.MockTransport(provider.handler),
    )

    assert await exchange(oidc) == "000042"
    assert provider.calls[0] == f"GET {DISCOVERY_URL}"


async def test_a_good_code_becomes_the_personnel_number(provider, diagnostics) -> None:
    oidc = client(provider)

    number = await exchange(oidc)
    again = await exchange(oidc)

    assert (number, again) == ("000042", "000042")
    assert provider.exchanges[0] == {
        "grant_type": "authorization_code",
        "code": CODE,
        "redirect_uri": "http://localhost:8080/api/v1/auth/sso/callback",
        "client_id": CLIENT_ID,
        "code_verifier": VERIFIER,
    }
    # Discovery and the key set are read once; the second exchange is one call.
    assert provider.calls == [
        f"GET {DISCOVERY_URL}",
        f"POST {TOKEN_URL}",
        f"GET {JWKS_URL}",
        f"POST {TOKEN_URL}",
    ]
    assert records(diagnostics) == []


async def test_a_token_without_azp_is_accepted(provider) -> None:
    provider.token = provider.id_token(azp=None)

    assert await exchange(client(provider)) == "000042"


async def test_a_rotated_key_is_fetched_once_without_a_restart(provider, other_key) -> None:
    oidc = client(provider)
    await exchange(oidc)
    provider.private_key, provider.kid = other_key, "key-2"

    assert await exchange(oidc) == "000042"
    assert provider.calls.count(f"GET {JWKS_URL}") == 2


@pytest.mark.parametrize(
    ("claims", "reason"),
    [
        ({"iss": "https://sso.example/realms/other"}, "issuer_mismatch"),
        ({"aud": "other-client"}, "audience_mismatch"),
        ({"exp": -1}, "token_expired"),
        ({"iat": 10**10}, "ImmatureSignatureError"),
        ({"exp": None}, "MissingRequiredClaimError"),
        ({"nonce": "nonce-of-another-browser"}, "nonce_mismatch"),
        ({"azp": "other-client"}, "azp_mismatch"),
        ({"employeeNumber": None}, "claim_missing"),
        ({"employeeNumber": "A42"}, "claim_invalid"),
        ({"employeeNumber": "1" * 33}, "claim_invalid"),
        ({"employeeNumber": 42}, "claim_invalid"),
        ({"employeeNumber": ""}, "claim_invalid"),
    ],
)
async def test_an_id_token_that_fails_a_check_is_rejected_with_the_reason(
    provider, diagnostics, claims, reason
) -> None:
    provider.token = provider.id_token(**claims)

    with pytest.raises(SsoRejectedError) as refused:
        await exchange(client(provider))

    assert (refused.value.phase, refused.value.reason) == ("verify", reason)
    [record] = records(diagnostics)
    assert record | {"event": "sso_auth", "outcome": "rejected", "phase": "verify"} == record
    assert (record["reason"], record["level"]) == (reason, "INFO")
    assert "elapsed_ms" in record


async def test_a_token_signed_with_another_key_is_rejected(provider, other_key) -> None:
    provider.token = provider.id_token(key=other_key)

    with pytest.raises(SsoRejectedError, match="verify: signature_invalid"):
        await exchange(client(provider))


async def test_an_unsigned_token_is_rejected(provider) -> None:
    provider.token = jwt.encode(
        {"iss": ISSUER, "aud": CLIENT_ID, "exp": 10**10, "iat": 1, "nonce": NONCE},
        key=None,
        algorithm="none",
        headers={"kid": provider.kid},
    )

    with pytest.raises(SsoRejectedError, match="verify: InvalidAlgorithmError"):
        await exchange(client(provider))


async def test_a_token_naming_an_unknown_key_is_rejected_after_one_refetch(provider) -> None:
    provider.token = provider.id_token(kid="key-9")

    with pytest.raises(SsoRejectedError, match="verify: unknown_kid"):
        await exchange(client(provider))

    assert provider.calls.count(f"GET {JWKS_URL}") == 2


async def test_something_that_is_not_a_token_is_rejected(provider) -> None:
    provider.token = "not-a-token"

    with pytest.raises(SsoRejectedError, match="verify: token_malformed"):
        await exchange(client(provider))


async def test_the_claim_name_is_the_configured_one(provider) -> None:
    provider.token = provider.id_token(employeeNumber=None, personnelId="000043")

    assert await exchange(client(provider, sso_claim_personnel_number="personnelId")) == "000043"


@pytest.mark.parametrize(
    ("failure", "reason"),
    [
        (httpx.ConnectTimeout("timed out"), "timeout"),
        (httpx.ReadTimeout("timed out"), "timeout"),
        (httpx.ConnectError("[Errno -2] Name or service not known"), "host_not_resolved"),
        (httpx.ConnectError("All connection attempts failed"), "connection_refused"),
        (
            httpx.ConnectError("[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed"),
            "certificate_verify_failed",
        ),
        (httpx.RemoteProtocolError("Server disconnected"), "RemoteProtocolError"),
    ],
)
async def test_a_provider_that_cannot_be_reached_is_unavailable_with_the_reason(
    provider, diagnostics, failure, reason
) -> None:
    provider.failure = failure

    with pytest.raises(SsoUnavailableError) as unavailable:
        await authorization_url(client(provider))

    assert (unavailable.value.phase, unavailable.value.reason) == ("discovery", reason)
    [record] = records(diagnostics)
    assert (record["outcome"], record["phase"], record["reason"], record["level"]) == (
        "unavailable",
        "discovery",
        reason,
        "WARNING",
    )


@pytest.mark.parametrize(
    ("answer", "reason"),
    [
        (httpx.Response(503, text="down"), "http_503"),
        (httpx.Response(200, text="<html>"), "not_json"),
        (httpx.Response(200, json=["x"]), "not_json"),
        (httpx.Response(200, json={"authorization_endpoint": AUTH_URL}), "document_invalid"),
    ],
)
async def test_a_discovery_document_the_client_cannot_use_is_unavailable(
    provider, answer, reason
) -> None:
    provider.answers[DISCOVERY_URL] = answer

    with pytest.raises(SsoUnavailableError, match=f"discovery: {reason}"):
        await authorization_url(client(provider))


@pytest.mark.parametrize(
    ("answer", "outcome", "reason"),
    [
        (httpx.Response(502, text="bad gateway"), SsoUnavailableError, "http_502"),
        (httpx.Response(400, json={"error": "invalid_grant"}), SsoRejectedError, "invalid_grant"),
        (httpx.Response(400, text="bad request"), SsoRejectedError, "http_400"),
        (httpx.Response(401, json={"error": 7}), SsoRejectedError, "http_401"),
        (httpx.Response(200, json={"access_token": "a"}), SsoRejectedError, "id_token_missing"),
        (httpx.Response(200, json={"id_token": ""}), SsoRejectedError, "id_token_missing"),
        (httpx.Response(200, text="<html>"), SsoRejectedError, "id_token_missing"),
    ],
)
async def test_the_token_endpoints_answer_decides_between_unavailable_and_rejected(
    provider, answer, outcome, reason
) -> None:
    provider.answers[TOKEN_URL] = answer

    with pytest.raises(outcome, match=f"exchange: {reason}"):
        await exchange(client(provider))


@pytest.mark.parametrize(
    ("answer", "reason"),
    [
        (httpx.Response(500, text="error"), "http_500"),
        (httpx.Response(200, json={"keys": []}), "jwks_invalid"),
        (httpx.Response(200, json={"keys": "none"}), "jwks_invalid"),
    ],
)
async def test_a_key_set_the_client_cannot_use_is_unavailable(provider, answer, reason) -> None:
    provider.answers[JWKS_URL] = answer

    with pytest.raises(SsoUnavailableError, match=f"verify: {reason}"):
        await exchange(client(provider))


async def test_an_unreadable_ca_file_fails_the_call_and_names_the_reason(
    provider, tmp_path: Path
) -> None:
    with pytest.raises(SsoUnavailableError, match="discovery: ca_file_unreadable"):
        await authorization_url(client(provider, ca_file=str(tmp_path)))

    assert provider.calls == []


async def test_a_readable_ca_file_is_accepted(provider, tmp_path: Path) -> None:
    bundle, _ = private_ca(tmp_path)

    assert await exchange(client(provider, ca_file=str(bundle))) == "000042"


async def test_a_defect_is_an_outage_for_the_person_and_an_error_in_the_log(
    provider, diagnostics
) -> None:
    provider.failure = RuntimeError(f"boom {CODE}")

    with pytest.raises(SsoUnavailableError) as unavailable:
        await exchange(client(provider))

    assert (unavailable.value.phase, unavailable.value.reason) == ("discovery", "unexpected_error")
    assert isinstance(unavailable.value.__cause__, RuntimeError)
    [record] = records(diagnostics)
    assert (record["level"], record["reason"], record["error"]) == (
        "ERROR",
        "unexpected_error",
        "builtins.RuntimeError",
    )
    assert "boom" not in diagnostics.text


def test_one_client_serves_the_process() -> None:
    assert get_sso_client() is get_sso_client()
    assert get_sso_client().settings is get_settings()
