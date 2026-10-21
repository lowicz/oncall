"""Single sign-on through an OpenID Connect provider (Keycloak).

The API brokers the whole Authorization Code flow with PKCE: the start route
sends the browser to the provider with a state, a nonce and a code challenge
it remembers in a short-lived cookie, and the callback exchanges the code
over a back channel, verifies the ID token's signature and claims, and reads
the personnel number from the claim `ONCALL_SSO_CLAIM_PERSONNEL_NUMBER`
names. That number is all the application relies on: the routes look it up
the way a directory sign-in binds on it, and nothing is provisioned,
synchronised or converted. The browser follows two redirects and never sees
a token.

A conversation that ends without a personnel number is logged once through
`oncall.login_log` (`event=sso_auth`) with the phase it stopped in -
`discovery`, `exchange` or `verify` - and a stable reason code; the caller
gets one of two outcomes, `SsoUnavailableError` when the provider could not
be reached or answered something this application cannot use, and
`SsoRejectedError` when it refused the code or the ID token is not one this
application accepts. Nothing of the code, the token response or the ID token
reaches the log.

The discovery document is read on first use and kept for the process; the
JWK set is kept too and read again once when a token names an unknown key,
so a key rotation at the provider needs no restart here.
"""

import base64
import contextlib
import hashlib
import logging
import time
from collections.abc import Awaitable, Callable
from functools import lru_cache
from typing import Any
from urllib.parse import urlencode

import httpx
import jwt

from oncall import login_log, trust
from oncall.config import Settings, get_settings

CALLBACK_PATH = "/api/v1/auth/sso/callback"
#: The signature algorithms an ID token may carry; `none` is never one.
ALGORITHMS = ("RS256", "ES256")
#: Clock skew tolerated between this host and the provider, in seconds.
LEEWAY_SECONDS = 60
#: `users.personnel_number`'s own rule: ASCII digits, at most this long.
PERSONNEL_NUMBER_MAX_LENGTH = 32

#: Why an ID token was refused, by the PyJWT exception that refused it; any
#: other one is named by its class.
_TOKEN_REASONS: dict[type[jwt.PyJWTError], str] = {
    jwt.ExpiredSignatureError: "token_expired",
    jwt.InvalidSignatureError: "signature_invalid",
    jwt.InvalidAudienceError: "audience_mismatch",
    jwt.InvalidIssuerError: "issuer_mismatch",
}
#: Transport failures as httpx words them, from most to least specific.
_TRANSPORT_REASONS = (
    ("CERTIFICATE_VERIFY_FAILED", "certificate_verify_failed"),
    ("Name or service not known", "host_not_resolved"),
    ("Temporary failure in name resolution", "host_not_resolved"),
    ("nodename nor servname provided", "host_not_resolved"),
    ("Connection refused", "connection_refused"),
    ("All connection attempts failed", "connection_refused"),
)


class SsoError(Exception):
    """A sign-on conversation that ended without a personnel number. `phase`
    and `reason` are codes for the operator's log, never a token or a URL."""

    def __init__(self, phase: str, reason: str) -> None:
        super().__init__(f"sso {phase}: {reason}")
        self.phase = phase
        self.reason = reason


class SsoUnavailableError(SsoError):
    """The provider could not be reached or answered something this
    application cannot use; signing in with a password still works."""


class SsoRejectedError(SsoError):
    """The provider refused the code, or its ID token is not one this
    application accepts."""


def code_challenge(code_verifier: str) -> str:
    """The S256 challenge of a PKCE verifier, as the provider expects it."""
    digest = hashlib.sha256(code_verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _json_object(response: httpx.Response) -> dict[str, Any] | None:
    try:
        document = response.json()
    except ValueError:
        return None
    return document if isinstance(document, dict) else None


def _transport_reason(exc: httpx.RequestError) -> str:
    if isinstance(exc, httpx.TimeoutException):
        return "timeout"
    text = str(exc)
    return next(
        (reason for needle, reason in _TRANSPORT_REASONS if needle in text), type(exc).__name__
    )


class _Attempt:
    """Where one conversation with the provider is, so that its failure can
    say so."""

    def __init__(self) -> None:
        self.phase = "discovery"
        self._started = time.monotonic()

    def log(self, outcome: str, level: int, phase: str, **fields: object) -> None:
        login_log.emit(
            "sso_auth",
            level=level,
            outcome=outcome,
            phase=phase,
            **fields,
            elapsed_ms=round((time.monotonic() - self._started) * 1000),
        )


class OidcClient:
    """The provider as the sign-in routes see it. One instance serves the
    process (`get_sso_client`); `transport` replaces the network, for the
    tests' fake provider."""

    def __init__(
        self, settings: Settings, *, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        self.settings = settings
        self._transport = transport
        self._discovery: dict[str, Any] | None = None
        self._jwks: jwt.PyJWKSet | None = None

    @property
    def redirect_uri(self) -> str:
        """Where the provider sends the browser back: the value to register
        on the client at the provider, scheme, host and port included."""
        return self.settings.public_base_url.rstrip("/") + CALLBACK_PATH

    async def authorization_url(self, *, state: str, nonce: str, code_verifier: str) -> str:
        """Where to send the browser to sign in. Raises `SsoUnavailableError`
        when discovery fails, so the browser is never sent to a dead host."""
        return await self._run(
            lambda attempt: self._authorization_url(attempt, state, nonce, code_verifier)
        )

    async def exchange(self, code: str, *, code_verifier: str, nonce: str) -> str:
        """The personnel number the provider vouches for, from the code it
        sent back. Raises `SsoUnavailableError` or `SsoRejectedError`."""
        return await self._run(lambda attempt: self._exchange(attempt, code, code_verifier, nonce))

    async def _run[T](self, conversation: Callable[[_Attempt], Awaitable[T]]) -> T:
        """One conversation with the provider, its failure logged once."""
        attempt = _Attempt()
        try:
            return await conversation(attempt)
        except SsoError as failure:
            unavailable = isinstance(failure, SsoUnavailableError)
            attempt.log(
                "unavailable" if unavailable else "rejected",
                logging.WARNING if unavailable else logging.INFO,
                failure.phase,
                reason=failure.reason,
            )
            raise
        except Exception as exc:
            # A defect here or in a library still leaves a provider that
            # cannot answer: the person gets the outage answer instead of a
            # bare 500, and the log names the exception, not its message,
            # which may quote the provider's answer.
            kind = type(exc)
            attempt.log(
                "unavailable",
                logging.ERROR,
                attempt.phase,
                reason="unexpected_error",
                error=f"{kind.__module__}.{kind.__name__}",
            )
            raise SsoUnavailableError(attempt.phase, "unexpected_error") from exc

    async def _authorization_url(
        self, attempt: _Attempt, state: str, nonce: str, code_verifier: str
    ) -> str:
        endpoint = (await self._discover(attempt))["authorization_endpoint"]
        query = urlencode(
            {
                "response_type": "code",
                "client_id": self.settings.sso_client_id or "",
                "redirect_uri": self.redirect_uri,
                "scope": "openid",
                "state": state,
                "nonce": nonce,
                "code_challenge": code_challenge(code_verifier),
                "code_challenge_method": "S256",
            }
        )
        return f"{endpoint}{'&' if '?' in endpoint else '?'}{query}"

    async def _exchange(self, attempt: _Attempt, code: str, code_verifier: str, nonce: str) -> str:
        document = await self._discover(attempt)
        attempt.phase = "exchange"
        response = await self._send(
            attempt,
            "POST",
            document["token_endpoint"],
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": self.redirect_uri,
                "client_id": self.settings.sso_client_id or "",
                "code_verifier": code_verifier,
            },
        )
        body = _json_object(response)
        if response.status_code >= 500:
            raise SsoUnavailableError("exchange", f"http_{response.status_code}")
        if not response.is_success:
            # `invalid_grant`: an expired or reused code, or a verifier that
            # does not match the challenge; the provider's own code is the
            # reason, and never anything else it says.
            reason = body.get("error") if body else None
            raise SsoRejectedError(
                "exchange",
                reason if isinstance(reason, str) and reason else f"http_{response.status_code}",
            )
        id_token = body.get("id_token") if body else None
        if not isinstance(id_token, str) or not id_token:
            raise SsoRejectedError("exchange", "id_token_missing")
        attempt.phase = "verify"
        return await self._personnel_number(attempt, id_token, nonce)

    async def _personnel_number(self, attempt: _Attempt, id_token: str, nonce: str) -> str:
        """The number claim of an ID token this application accepts: signed
        by the provider's key, issued by the configured issuer for the
        configured client, in date, and bound to this browser's nonce."""
        settings = self.settings
        try:
            kid = jwt.get_unverified_header(id_token).get("kid")
        except jwt.PyJWTError as exc:
            raise SsoRejectedError("verify", "token_malformed") from exc
        key = await self._signing_key(attempt, kid)
        try:
            claims = jwt.decode(
                id_token,
                key.key,
                algorithms=list(ALGORITHMS),
                audience=settings.sso_client_id or "",
                issuer=settings.sso_issuer or "",
                leeway=LEEWAY_SECONDS,
                options={"require": ["exp", "iat"]},
            )
        except jwt.PyJWTError as exc:
            raise SsoRejectedError(
                "verify", _TOKEN_REASONS.get(type(exc), type(exc).__name__)
            ) from exc
        if claims.get("nonce") != nonce:
            raise SsoRejectedError("verify", "nonce_mismatch")
        if claims.get("azp", settings.sso_client_id) != settings.sso_client_id:
            raise SsoRejectedError("verify", "azp_mismatch")
        number = claims.get(settings.sso_claim_personnel_number)
        if number is None:
            raise SsoRejectedError("verify", "claim_missing")
        if not (
            isinstance(number, str)
            and number.isascii()
            and number.isdigit()
            and len(number) <= PERSONNEL_NUMBER_MAX_LENGTH
        ):
            raise SsoRejectedError("verify", "claim_invalid")
        return number

    async def _signing_key(self, attempt: _Attempt, kid: str) -> jwt.PyJWK:
        """The provider's key named by `kid`, from the kept JWK set or, once,
        from a fresh one: a rotated key is found without a restart."""
        for refetch in (False, True):
            if refetch or self._jwks is None:
                self._jwks = await self._fetch_jwks(attempt)
            with contextlib.suppress(KeyError):
                return self._jwks[kid]
        raise SsoRejectedError("verify", "unknown_kid")

    async def _fetch_jwks(self, attempt: _Attempt) -> jwt.PyJWKSet:
        document = await self._fetch_json(attempt, (await self._discover(attempt))["jwks_uri"])
        try:
            return jwt.PyJWKSet.from_dict(document)
        except jwt.PyJWTError as exc:
            raise SsoUnavailableError(attempt.phase, "jwks_invalid") from exc

    async def _discover(self, attempt: _Attempt) -> dict[str, Any]:
        if self._discovery is None:
            attempt.phase = "discovery"
            issuer = (self.settings.sso_issuer or "").rstrip("/")
            document = await self._fetch_json(attempt, f"{issuer}/.well-known/openid-configuration")
            if not all(
                isinstance(document.get(name), str)
                for name in ("authorization_endpoint", "token_endpoint", "jwks_uri")
            ):
                raise SsoUnavailableError("discovery", "document_invalid")
            self._discovery = document
        return self._discovery

    async def _fetch_json(self, attempt: _Attempt, url: str) -> dict[str, Any]:
        response = await self._send(attempt, "GET", url)
        if not response.is_success:
            raise SsoUnavailableError(attempt.phase, f"http_{response.status_code}")
        document = _json_object(response)
        if document is None:
            raise SsoUnavailableError(attempt.phase, "not_json")
        return document

    async def _send(
        self, attempt: _Attempt, method: str, url: str, **request: Any
    ) -> httpx.Response:
        """One call to the provider, verified against the public roots plus
        `ONCALL_CA_FILE`, bounded by `ONCALL_SSO_TIMEOUT_SECONDS`."""
        try:
            verify = trust.tls_context(self.settings)
        except trust.CaFileUnreadable as exc:
            raise SsoUnavailableError(attempt.phase, "ca_file_unreadable") from exc
        try:
            async with httpx.AsyncClient(
                verify=verify,
                timeout=self.settings.sso_timeout_seconds,
                transport=self._transport,
            ) as http:
                return await http.request(method, url, **request)
        except httpx.RequestError as exc:
            raise SsoUnavailableError(attempt.phase, _transport_reason(exc)) from exc


@lru_cache
def get_sso_client() -> OidcClient:
    return OidcClient(get_settings())
