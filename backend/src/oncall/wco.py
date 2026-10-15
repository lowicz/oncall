"""Client of the Orange WCO admin API, for forwarding the on-call number.

WCO forwards the on-call number to the `number` of one of its users. The
client opens a session the way the WCO site does: `GET /admin_api/login` sets
an `XSRF-TOKEN` cookie, every later call echoes it in the `X-XSRF-TOKEN`
header, and `POST /admin_api/perform_login` puts the session cookies into the
jar. Then it reads a user, writes it back whole with a field replaced
(`PUT /admin_api/functionalities/user` takes no id), and changes an expired
password (`POST /admin_api/change-password`, both values URL-encoded inside
the JSON, as WCO expects them).

An expired password does not refuse the login: the login succeeds and the
user calls answer 403, which is `WcoPasswordExpired`; a refused login is
`WcoLoginRefused`. Every error names the call and the HTTP status only: what
WCO answered may echo what was sent, so neither ends up in an error or a log,
and the client logs nothing of its own (httpx logs the method and the URL).

TLS is always verified, against the image's public roots plus the CAs of an
optional CA file, for a TLS proxy that re-signs the traffic.
"""

import ssl
from types import TracebackType
from typing import Any, Self
from urllib.parse import quote

import httpx

TIMEOUT_SECONDS = 15.0
_CONTENT_TYPE = "application/json;charset=UTF-8"
_XSRF_COOKIE = "XSRF-TOKEN"
_LOGIN = "/admin_api/login"
_PERFORM_LOGIN = "/admin_api/perform_login"
_USER = "/admin_api/functionalities/user"
_CHANGE_PASSWORD = "/admin_api/change-password"


class WcoError(Exception):
    """A WCO call that did not succeed; `status` is None when no answer came."""

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class WcoConfigurationError(WcoError):
    """The local TLS configuration prevents a safe WCO connection."""


class WcoLoginRefused(WcoError):
    """WCO refused the switchboard number, login and password."""


class WcoPasswordExpired(WcoError):
    """The login succeeded, but the password has to be changed first."""


_REFUSED: dict[int, type[WcoError]] = {401: WcoLoginRefused, 403: WcoLoginRefused}
_EXPIRED: dict[int, type[WcoError]] = {403: WcoPasswordExpired}


def tls_context(ca_file: str | None) -> ssl.SSLContext:
    """The public roots, plus the CAs of `ca_file` when one is set: added to
    them, not put in their place, as for the SMTP relay."""
    context = ssl.create_default_context()
    if ca_file:
        try:
            context.load_verify_locations(cafile=ca_file)
        except OSError as exc:
            raise WcoConfigurationError(
                f"the WCO CA file is unreadable ({ca_file}): {exc}"
            ) from exc
    return context


class WcoClient:
    """One WCO session; use it as `async with WcoClient(...) as wco`.

    `transport` replaces the network, for the tests' fake WCO."""

    def __init__(
        self,
        base_url: str,
        *,
        ca_file: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._http = httpx.AsyncClient(
            base_url=base_url,
            verify=tls_context(ca_file),
            transport=transport,
            timeout=TIMEOUT_SECONDS,
            # A redirect to another origin must never receive the stored
            # password. WCO's observed endpoints answer directly, so any 3xx
            # is treated as an error instead of followed.
            follow_redirects=False,
        )
        self._xsrf: str | None = None

    async def __aenter__(self) -> Self:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        await self._http.aclose()

    async def login(self, vpbx_number: str, username: str, password: str) -> None:
        """Open a new session, dropping whatever an earlier one left in the jar."""
        self._http.cookies.clear()
        self._xsrf = None
        await self._call("GET", _LOGIN)
        self._xsrf = self._http.cookies.get(_XSRF_COOKIE)
        if not self._xsrf:
            raise WcoError(f"GET {_LOGIN} set no {_XSRF_COOKIE} cookie")
        body = {
            "vpbxNumber": vpbx_number,
            "username": username,
            "password": password,
            "language": None,
        }
        await self._call("POST", _PERFORM_LOGIN, body, errors=_REFUSED)

    async def get_user(self, user_id: str) -> dict[str, Any]:
        path = f"{_USER}/{user_id}"
        response = await self._call("GET", path, errors=_EXPIRED)
        try:
            user = response.json()
        except ValueError:
            user = None
        if not isinstance(user, dict):
            raise WcoError(f"GET {path} answered no user object", response.status_code)
        return user

    async def update_user(self, user: dict[str, Any]) -> None:
        """Write back the whole object `get_user` read, with fields replaced:
        WCO takes the object as it is sent, so a field left out is lost."""
        await self._call("PUT", _USER, user, errors=_EXPIRED)

    async def change_password(self, old: str, new: str) -> None:
        """Change the password of the session's login; WCO may end the
        session with it, so log in again with `new` afterwards."""
        body = {"oldPassword": quote(old, safe=""), "newPassword": quote(new, safe="")}
        await self._call("POST", _CHANGE_PASSWORD, body)

    async def _call(
        self,
        method: str,
        path: str,
        body: dict[str, Any] | None = None,
        *,
        errors: dict[int, type[WcoError]] | None = None,
    ) -> httpx.Response:
        headers = {"Content-Type": _CONTENT_TYPE}
        if self._xsrf:
            headers["X-XSRF-TOKEN"] = self._xsrf
        try:
            response = await self._http.request(method, path, headers=headers, json=body)
        except httpx.RequestError as exc:
            raise WcoError(f"{method} {path} failed: {type(exc).__name__}: {exc}") from exc
        if not response.is_success:
            status = response.status_code
            error = (errors or {}).get(status, WcoError)
            raise error(f"{method} {path} answered HTTP {status}", status)
        return response
