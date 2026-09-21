"""Replaceable LDAP/Active Directory authentication backend.

The ldap3 client is synchronous, so network work is kept outside FastAPI's
event loop with ``asyncio.to_thread``. The rest of the application consumes a
small identity object and does not depend on LDAP protocol details.

An attempt walks through named phases - ``config``, ``connect``, ``tls``,
``service_bind``, ``search``, ``user_bind``, ``attributes`` - and one that ends
without an identity is logged once through `oncall.login_log`: the phase it
stopped in, a stable reason code and, where the library gave one, a short
detail such as the certificate verification message. The person signing in
still gets the one generic answer; docs/wdrozenie/ldap.md tells an operator
what each reason means and what to change.
"""

import asyncio
import contextlib
import logging
import math
import os
import re
import ssl
import time
import traceback
from collections.abc import Iterator
from functools import lru_cache
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from email_validator import EmailNotValidError, validate_email
from ldap3 import NONE, SUBTREE, Connection, Server, Tls
from ldap3.core.exceptions import (
    LDAPException,
    LDAPInvalidCredentialsResult,
    LDAPInvalidFilterError,
    LDAPOperationResult,
    LDAPResponseTimeoutError,
    LDAPSessionTerminatedByServerError,
    LDAPStartTLSError,
)
from ldap3.utils.conv import escape_filter_chars

from oncall import login_log
from oncall.config import Settings, get_settings

# Declared by the domain, which decides what a directory identity may sign in
# as; re-exported so callers of this client keep one import.
from oncall.domain.access.models import DirectoryIdentity as DirectoryIdentity

DEFAULT_USER_FILTER = "(&(objectClass=user)(sAMAccountName={username}))"

#: What the audit trail records as the reason, by the phase that failed.
_PHASE_MESSAGES = {
    "config": "Konfiguracja LDAP jest niepełna",
    "connect": "Nie można połączyć się z katalogiem LDAP",
    "tls": "Nie można zestawić szyfrowanego połączenia z katalogiem LDAP",
    "service_bind": "Konto serwisowe LDAP nie może się zalogować",
    "search": "Wyszukiwanie LDAP nie powiodło się",
    "user_bind": "Katalog LDAP przerwał weryfikację hasła",
}
UNEXPECTED_FAILURE = "Nieoczekiwany błąd klienta LDAP"

#: The sub-code Active Directory puts in a refused bind's diagnostic text
#: (`... AcceptSecurityContext error, data 775, ...`). The code alone is
#: logged; the text around it is not.
_AD_BIND_CODES = {
    "525": "user_not_found",
    "52e": "invalid_credentials",
    "530": "logon_hours_restricted",
    "531": "workstation_restricted",
    "532": "password_expired",
    "533": "account_disabled",
    "701": "account_expired",
    "773": "password_must_change",
    "775": "account_locked",
}
_AD_DATA = re.compile(r"\bdata ([0-9a-f]{3,8})\b", re.IGNORECASE)
_VERIFY_MESSAGE = re.compile(r"certificate verify failed: ([^(]+?)\s*\(")
_SSL_REASON = re.compile(r"\[(?:SSL|X509)(?:: ([A-Z0-9_]+))?\]")
_WORD = re.compile(r"[A-Za-z]+")
#: Socket failures, as ldap3 words them, from most to least specific.
_SOCKET_REASONS = (
    ("invalid server address", "host_not_resolved"),
    ("Connection refused", "connection_refused"),
    ("timed out", "timeout"),
    ("No route to host", "unreachable"),
    ("Network is unreachable", "unreachable"),
    ("Connection reset", "connection_closed"),
)


class DirectoryUnavailableError(Exception):
    """The configured directory could not safely complete authentication.

    `phase` and `reason` say where and why for the operator's log; `details`
    holds further codes (never a secret, a DN or a directory message)."""

    def __init__(
        self,
        message: str,
        *,
        phase: str = "directory",
        reason: str = "unavailable",
        **details: object,
    ) -> None:
        super().__init__(message)
        self.phase = phase
        self.reason = reason
        self.details = details


class DirectoryIdentityError(Exception):
    """The directory entry lacks identity data required by this application.

    `attribute` is the configured attribute name at fault, never its value."""

    def __init__(
        self, message: str, *, reason: str = "invalid_identity", attribute: str | None = None
    ) -> None:
        super().__init__(message)
        self.reason = reason
        self.attribute = attribute


class _Attempt:
    """Where one authentication is, so that its failure can say so."""

    def __init__(self, login: str, server: str, tls: str) -> None:
        self.login = login
        self.server = server
        self.tls = tls
        self.phase = "config"
        self._started = time.monotonic()

    @contextlib.contextmanager
    def enter(self, phase: str) -> Iterator[None]:
        """Run one phase; an ldap3 failure in it becomes a classified outage."""
        self.phase = phase
        try:
            yield
        except LDAPException as exc:
            raise _unavailable(phase, exc) from exc

    def log(self, outcome: str, level: int, phase: str, **fields: object) -> None:
        login_log.emit(
            "ldap_auth",
            level=level,
            login=self.login,
            outcome=outcome,
            phase=phase,
            **fields,
            server=self.server,
            tls=self.tls,
            elapsed_ms=round((time.monotonic() - self._started) * 1000),
        )


class LdapAuthenticator:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def authenticate(self, username: str, password: str) -> DirectoryIdentity | None:
        if not self.settings.ldap_enabled:
            return None
        return await asyncio.to_thread(self._authenticate_sync, username, password)

    def _endpoint(self) -> tuple[str, str, int] | None:
        """Scheme, host and port of the configured server; None when the URI
        is not one. User information in the URI is never read."""
        uri = urlparse(self.settings.ldap_server_uri or "")
        try:
            port = uri.port
        except ValueError:
            return None
        if uri.scheme not in {"ldap", "ldaps"} or not uri.hostname:
            return None
        return uri.scheme, uri.hostname, port or (636 if uri.scheme == "ldaps" else 389)

    def _server(self) -> Server:
        endpoint = self._endpoint()
        if endpoint is None:
            raise DirectoryUnavailableError(
                "Nieprawidłowa konfiguracja serwera LDAP",
                phase="config",
                reason="server_uri_invalid",
            )
        scheme, host, port = endpoint
        ca_file = self.settings.ldap_ca_file or None
        if ca_file is not None and not (Path(ca_file).is_file() and os.access(ca_file, os.R_OK)):
            raise DirectoryUnavailableError(
                "Plik CA katalogu LDAP jest niedostępny",
                phase="config",
                reason="ca_file_unreadable",
                detail=ca_file,
            )
        return Server(
            host,
            port=port,
            use_ssl=scheme == "ldaps",
            get_info=NONE,
            connect_timeout=self.settings.ldap_connect_timeout_seconds,
            # Without a CA file the image's public roots decide, and an
            # enterprise CA (Active Directory Certificate Services) is not
            # among them.
            tls=Tls(validate=ssl.CERT_REQUIRED, ca_certs_file=ca_file),
        )

    def _server_label(self) -> tuple[str, str]:
        """The server and its transport security, as the log shows them."""
        endpoint = self._endpoint()
        if endpoint is None:
            return "invalid", "none"
        scheme, host, port = endpoint
        if scheme == "ldaps":
            return f"ldaps://{host}:{port}", "ldaps"
        return f"ldap://{host}:{port}", "starttls" if self.settings.ldap_start_tls else "none"

    def _connection(self, server: Server, user: str, password: str) -> Connection:
        return Connection(
            server,
            user=user,
            password=password,
            raise_exceptions=True,
            # ldap3 packs this into SO_RCVTIMEO as an integer on Linux, and a
            # float fails there with `struct.error` on every connection.
            receive_timeout=math.ceil(self.settings.ldap_connect_timeout_seconds),
        )

    @contextlib.contextmanager
    def _session(
        self, attempt: _Attempt, server: Server, user: str, password: str, bind_phase: str
    ) -> Iterator[Connection]:
        connection = self._connection(server, user, password)
        try:
            with attempt.enter("connect"):
                connection.open()
            if self.settings.ldap_start_tls and not server.ssl:
                with attempt.enter("tls"):
                    connection.start_tls()
            with attempt.enter(bind_phase):
                if not connection.bind():
                    raise DirectoryUnavailableError(
                        _PHASE_MESSAGES[bind_phase], phase=bind_phase, reason="bind_refused"
                    )
            yield connection
        finally:
            with contextlib.suppress(LDAPException, OSError):
                connection.unbind()

    @staticmethod
    def _value(entry: Any, attribute: str) -> str:
        """The attribute's first value, or '' when the entry has none.

        Matched without regard to case, as LDAP attribute names are: the entry
        is keyed by the server's spelling (`employeeID`) whatever spelling was
        configured, and by the configured one only when the value is absent.
        """
        wanted = attribute.lower()
        for name, values in entry.entry_attributes_as_dict.items():
            if name.lower() != wanted or not values:
                continue
            value = values[0] if isinstance(values, list) else values
            if isinstance(value, bytes):
                try:
                    value = value.decode("utf-8", errors="strict")
                except UnicodeDecodeError as exc:
                    raise DirectoryIdentityError(
                        "Atrybut konta katalogowego nie jest tekstem",
                        reason="attribute_not_text",
                        attribute=attribute,
                    ) from exc
            return str(value).strip()
        return ""

    def _identity(self, entry: Any, username: str) -> DirectoryIdentity:
        settings = self.settings
        personnel_number = self._value(entry, settings.ldap_attribute_personnel_number)
        first_name = self._value(entry, settings.ldap_attribute_first_name)
        last_name = self._value(entry, settings.ldap_attribute_last_name)
        email = self._value(entry, settings.ldap_attribute_email) or None
        if not personnel_number:
            raise DirectoryIdentityError(
                "Konto katalogowe nie ma poprawnego, numerycznego numeru pracownika",
                reason="personnel_number_missing",
                attribute=settings.ldap_attribute_personnel_number,
            )
        if not personnel_number.isascii() or not personnel_number.isdigit():
            raise DirectoryIdentityError(
                "Konto katalogowe nie ma poprawnego, numerycznego numeru pracownika",
                reason="personnel_number_not_numeric",
                attribute=settings.ldap_attribute_personnel_number,
            )
        if not first_name:
            raise DirectoryIdentityError(
                "Konto katalogowe nie ma imienia",
                reason="first_name_missing",
                attribute=settings.ldap_attribute_first_name,
            )
        if email is not None:
            try:
                validate_email(email, check_deliverability=False)
            except EmailNotValidError as exc:
                raise DirectoryIdentityError(
                    "Konto katalogowe nie ma poprawnego adresu e-mail",
                    reason="email_invalid",
                    attribute=settings.ldap_attribute_email,
                ) from exc
        too_long = next(
            (
                attribute
                for attribute, value, limit in (
                    ("username", username, 120),
                    (settings.ldap_attribute_personnel_number, personnel_number, 32),
                    (settings.ldap_attribute_first_name, first_name, 120),
                    (settings.ldap_attribute_last_name, last_name, 120),
                    (settings.ldap_attribute_email, email or "", 320),
                )
                if len(value) > limit
            ),
            None,
        )
        if too_long is not None:
            raise DirectoryIdentityError(
                "Atrybut konta katalogowego jest zbyt długi",
                reason="attribute_too_long",
                attribute=too_long,
            )
        return DirectoryIdentity(username, personnel_number, first_name, last_name, email)

    def _search_settings(self, username: str) -> tuple[str, str, str, str]:
        """Bind DN, bind password, base DN and the filter for this login."""
        settings = self.settings
        required = (
            ("ONCALL_LDAP_SERVER_URI", settings.ldap_server_uri),
            ("ONCALL_LDAP_BIND_DN", settings.ldap_bind_dn),
            ("ONCALL_LDAP_BIND_PASSWORD", settings.ldap_bind_password),
            ("ONCALL_LDAP_BASE_DN", settings.ldap_base_dn),
        )
        missing = [name for name, value in required if not value]
        if missing:
            # An empty bind password is missing too: with a DN, Active
            # Directory takes it for an unauthenticated bind, not a service
            # account, and every search after it fails.
            raise DirectoryUnavailableError(
                _PHASE_MESSAGES["config"],
                phase="config",
                reason="settings_missing",
                missing=",".join(missing),
            )
        template = settings.ldap_user_filter or DEFAULT_USER_FILTER
        if "{username}" not in template:
            raise DirectoryUnavailableError(
                "Filtr LDAP nie zawiera pola {username}",
                phase="config",
                reason="filter_without_username",
            )
        return (
            settings.ldap_bind_dn or "",
            settings.ldap_bind_password or "",
            settings.ldap_base_dn or "",
            template.replace("{username}", escape_filter_chars(username)),
        )

    def _authenticate_sync(self, username: str, password: str) -> DirectoryIdentity | None:
        attempt = _Attempt(username, *self._server_label())
        try:
            return self._authenticate(attempt, username, password)
        except DirectoryUnavailableError as failure:
            attempt.log(
                "unavailable",
                logging.WARNING,
                failure.phase,
                reason=failure.reason,
                **failure.details,
            )
            raise
        except DirectoryIdentityError as failure:
            attempt.log(
                "invalid_identity",
                logging.WARNING,
                "attributes",
                reason=failure.reason,
                attribute=failure.attribute,
            )
            raise
        except Exception as exc:
            # A defect in this client or in ldap3 still leaves a directory that
            # cannot answer: the person gets the outage answer instead of a
            # bare 500, and the log names the exception and where it was
            # raised - not its message, which may quote the input.
            attempt.log(
                "unavailable",
                logging.ERROR,
                attempt.phase,
                reason="unexpected_error",
                error=_qualified_name(exc),
                at=_origin(exc),
            )
            raise DirectoryUnavailableError(
                UNEXPECTED_FAILURE, phase=attempt.phase, reason="unexpected_error"
            ) from exc

    def _authenticate(
        self, attempt: _Attempt, username: str, password: str
    ) -> DirectoryIdentity | None:
        settings = self.settings
        bind_dn, bind_password, base_dn, search_filter = self._search_settings(username)
        server = self._server()
        attributes = list(
            dict.fromkeys(
                (
                    settings.ldap_attribute_personnel_number,
                    settings.ldap_attribute_first_name,
                    settings.ldap_attribute_last_name,
                    settings.ldap_attribute_email,
                )
            )
        )
        with (
            self._session(attempt, server, bind_dn, bind_password, "service_bind") as service,
            attempt.enter("search"),
        ):
            # An empty result makes ldap3 answer False even though the search
            # succeeded, so the entries decide, not the return value; a
            # refused search has already raised.
            service.search(
                base_dn,
                search_filter,
                search_scope=SUBTREE,
                attributes=attributes,
                size_limit=2,
            )
            entries = list(service.entries)
        if not entries:
            attempt.log("rejected", logging.INFO, "search", reason="user_not_found")
            return None
        if len(entries) != 1:
            raise DirectoryUnavailableError(
                "Filtr LDAP zwrócił więcej niż jedno konto",
                phase="search",
                reason="multiple_entries",
            )
        entry = entries[0]
        if not password:
            # Never sent: a DN with an empty password is an unauthenticated
            # bind, which Active Directory answers with success.
            attempt.log("rejected", logging.INFO, "user_bind", reason="empty_password")
            return None
        try:
            with self._session(attempt, server, entry.entry_dn, password, "user_bind"):
                pass
        except DirectoryUnavailableError as failure:
            if not isinstance(failure.__cause__, LDAPInvalidCredentialsResult):
                raise
            attempt.log(
                "rejected", logging.INFO, "user_bind", reason=failure.reason, **failure.details
            )
            return None
        # Only once the password is proven: an entry this application cannot
        # use must not answer differently from a wrong password.
        attempt.phase = "attributes"
        return self._identity(entry, username)


def _unavailable(phase: str, exc: LDAPException) -> DirectoryUnavailableError:
    actual_phase, reason, details = _diagnose(exc)
    phase = actual_phase or phase
    return DirectoryUnavailableError(
        _PHASE_MESSAGES.get(phase, UNEXPECTED_FAILURE), phase=phase, reason=reason, **details
    )


def _diagnose(exc: LDAPException) -> tuple[str | None, str, dict[str, object]]:
    """A reason code for an ldap3 failure, plus the phase it belongs to when
    that is not the one it was raised in: an ``ldaps://`` socket negotiates TLS
    while it opens. Only codes and fixed library wording leave this function."""
    if isinstance(exc, LDAPOperationResult):
        # The server answered with a result code: its name is the reason.
        details: dict[str, object] = {"result": exc.result}
        match = _AD_DATA.search(exc.message or "")
        if match is not None:
            code = match.group(1).lower()
            details |= {"ad_code": code, "ad_reason": _AD_BIND_CODES.get(code)}
        return None, exc.description or "result_error", details
    text = str(exc)
    if "certificate verify failed" in text:
        match = _VERIFY_MESSAGE.search(text)
        return (
            "tls",
            "certificate_verify_failed",
            {"detail": match.group(1) if match is not None else None},
        )
    if "doesn't match any name" in text:
        return "tls", "certificate_name_mismatch", {}
    if "startTLS failed" in text:
        refused = _WORD.findall(text.rsplit(" - ", 1)[-1])
        return "tls", "start_tls_refused", {"detail": refused[0] if refused else None}
    ssl_reason = _SSL_REASON.search(text)
    if ssl_reason is not None or isinstance(exc, LDAPStartTLSError):
        code = ssl_reason.group(1) if ssl_reason is not None else None
        return "tls", "tls_failed", {"detail": code.lower() if code else None}
    if isinstance(exc, LDAPInvalidFilterError):
        return None, "invalid_filter", {}
    for needle, reason in _SOCKET_REASONS:
        if needle in text:
            return None, reason, {}
    if isinstance(exc, LDAPResponseTimeoutError):
        return None, "timeout", {}
    if isinstance(exc, LDAPSessionTerminatedByServerError):
        return None, "connection_closed", {}
    return None, type(exc).__name__, {}


def _qualified_name(exc: BaseException) -> str:
    kind = type(exc)
    return kind.__name__ if kind.__module__ == "builtins" else f"{kind.__module__}.{kind.__name__}"


def _origin(exc: BaseException) -> str | None:
    """File and line that raised, from the package down: enough to find the
    defect, with no local value or message in it."""
    frames = traceback.extract_tb(exc.__traceback__)
    if not frames:
        return None
    frame = frames[-1]
    path = Path(frame.filename).parts
    for anchor in ("site-packages", "src"):
        if anchor in path:
            path = path[path.index(anchor) + 1 :]
            break
    return f"{'/'.join(path[-4:])}:{frame.lineno}"


@lru_cache
def get_directory_authenticator() -> LdapAuthenticator:
    return LdapAuthenticator(get_settings())
