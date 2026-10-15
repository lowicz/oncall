"""A fake Orange WCO admin API for the tests of the WCO client.

It is an `httpx.MockTransport` handler, so the client's whole HTTP exchange
runs - cookies, headers, JSON - without a socket. It keeps the state WCO
keeps: the signed-in sessions, the account's
password and whether it expired, and the one user whose `number` the on-call
line forwards to. Like WCO it answers 403 to the user calls while the password
is expired, takes the passwords of `change-password` URL-encoded, and ends
every session once the password changed. Every request is kept in `requests`,
so a test reads the exact calls and payloads.

All credentials here are dummies.
"""

import json
import re
import secrets
from dataclasses import dataclass, field
from http.cookies import SimpleCookie
from typing import Any
from urllib.parse import quote, unquote

import httpx

BASE_URL = "https://wco.test"
LOGIN = "/admin_api/login"
PERFORM_LOGIN = "/admin_api/perform_login"
USER = "/admin_api/functionalities/user"
CHANGE_PASSWORD = "/admin_api/change-password"
#: WCO's stated rule: at least 8 characters, lower and upper case, digits and
#: special characters.
_POLICY = (r".{8,}", r"[a-z]", r"[A-Z]", r"[0-9]", r"[^A-Za-z0-9]")


@dataclass
class FakeWco:
    vpbx_number: str = "221234567"
    username: str = "oncall"
    password: str = "Dummy-Passw0rd!"
    user_id: str = "1001"
    user: dict[str, Any] = field(
        default_factory=lambda: {
            "id": 1001,
            "name": "Dyżur",
            "number": "+48600600600",
            "email": "dyzur@example.invalid",
        }
    )
    password_expired: bool = False
    #: Answer every call to a path with this status, or raise this exception
    #: where the network would fail.
    faults: dict[str, int | Exception | list[int | Exception | None]] = field(default_factory=dict)
    requests: list[httpx.Request] = field(default_factory=list)
    sessions: set[str] = field(default_factory=set)

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handle)

    @property
    def calls(self) -> list[str]:
        return [f"{request.method} {request.url.path}" for request in self.requests]

    def bodies(self, path: str) -> list[dict[str, Any]]:
        return [json.loads(r.content) for r in self.requests if r.url.path == path]

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        fault = self.faults.get(path)
        if isinstance(fault, list):
            fault = fault.pop(0)
        if isinstance(fault, Exception):
            raise fault
        if fault is not None:
            return httpx.Response(fault, text=f"<html>{self.password}</html>")
        if request.method == "GET" and path == LOGIN:
            token = secrets.token_urlsafe()
            return httpx.Response(200, headers={"Set-Cookie": f"XSRF-TOKEN={token}; Path=/"})
        cookies = {
            name: morsel.value
            for name, morsel in SimpleCookie(request.headers.get("cookie", "")).items()
        }
        xsrf = request.headers.get("X-XSRF-TOKEN")
        if xsrf is None or xsrf != cookies.get("XSRF-TOKEN"):
            return httpx.Response(403)  # what Spring Security answers to a CSRF failure
        body = json.loads(request.content) if request.content else None
        if request.method == "POST" and path == PERFORM_LOGIN:
            return self._perform_login(body)
        if cookies.get("Authorization") not in self.sessions:
            return httpx.Response(401)
        if request.method == "POST" and path == CHANGE_PASSWORD:
            return self._change_password(body)
        if self.password_expired:
            return httpx.Response(403)
        if request.method == "GET" and path == f"{USER}/{self.user_id}":
            return httpx.Response(200, json=self.user)
        if request.method == "PUT" and path == USER and body.keys() == self.user.keys():
            self.user = body
            return httpx.Response(200)
        return httpx.Response(400)

    def _perform_login(self, body: dict[str, Any]) -> httpx.Response:
        expected = {
            "vpbxNumber": self.vpbx_number,
            "username": self.username,
            "password": self.password,
            "language": None,
        }
        if body != expected:
            return httpx.Response(401)
        session = secrets.token_urlsafe()
        self.sessions.add(session)
        return httpx.Response(200, headers={"Set-Cookie": f"Authorization={session}; Path=/"})

    def _change_password(self, body: dict[str, Any]) -> httpx.Response:
        old, new = body["oldPassword"], body["newPassword"]
        if any(quote(unquote(value), safe="") != value for value in (old, new)):
            return httpx.Response(400)  # not URL-encoded the way WCO expects
        new = unquote(new)
        if unquote(old) != self.password or not all(re.search(p, new) for p in _POLICY):
            return httpx.Response(400)
        self.password = new
        self.password_expired = False
        self.sessions.clear()
        return httpx.Response(200)
