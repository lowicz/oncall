"""Replaceable LDAP/Active Directory authentication backend.

The ldap3 client is synchronous, so network work is kept outside FastAPI's
event loop with ``asyncio.to_thread``. The rest of the application consumes a
small identity object and does not depend on LDAP protocol details.
"""

import asyncio
import ssl
from functools import lru_cache
from urllib.parse import urlparse

from email_validator import EmailNotValidError, validate_email
from ldap3 import NONE, SUBTREE, Connection, Server, Tls
from ldap3.core.exceptions import LDAPException, LDAPInvalidCredentialsResult
from ldap3.utils.conv import escape_filter_chars

from oncall.config import Settings, get_settings

# Declared by the domain, which decides what a directory identity may sign in
# as; re-exported so callers of this client keep one import.
from oncall.domain.access.models import DirectoryIdentity as DirectoryIdentity

DEFAULT_USER_FILTER = "(&(objectClass=user)(sAMAccountName={username}))"


class DirectoryUnavailableError(Exception):
    """The configured directory could not safely complete authentication."""


class DirectoryIdentityError(Exception):
    """The directory entry lacks identity data required by this application."""


class LdapAuthenticator:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def authenticate(self, username: str, password: str) -> DirectoryIdentity | None:
        if not self.settings.ldap_enabled:
            return None
        return await asyncio.to_thread(self._authenticate_sync, username, password)

    def _server(self) -> Server:
        uri = urlparse(self.settings.ldap_server_uri or "")
        if uri.scheme not in {"ldap", "ldaps"} or not uri.hostname:
            raise DirectoryUnavailableError("Nieprawidłowa konfiguracja serwera LDAP")
        return Server(
            uri.hostname,
            port=uri.port or (636 if uri.scheme == "ldaps" else 389),
            use_ssl=uri.scheme == "ldaps",
            get_info=NONE,
            connect_timeout=self.settings.ldap_connect_timeout_seconds,
            tls=Tls(validate=ssl.CERT_REQUIRED),
        )

    def _connect(self, server: Server, user: str, password: str) -> Connection | None:
        connection = Connection(
            server,
            user=user,
            password=password,
            raise_exceptions=True,
            receive_timeout=self.settings.ldap_connect_timeout_seconds,
        )
        connection.open()
        if self.settings.ldap_start_tls and not server.ssl and not connection.start_tls():
            connection.unbind()
            raise DirectoryUnavailableError("Serwer LDAP odrzucił StartTLS")
        if not connection.bind():
            connection.unbind()
            return None
        return connection

    @staticmethod
    def _value(entry, attribute: str) -> str:
        values = entry.entry_attributes_as_dict.get(attribute, [])
        value = values[0] if isinstance(values, list) and values else values
        if isinstance(value, bytes):
            value = value.decode("utf-8", errors="strict")
        return str(value).strip() if value is not None else ""

    def _identity(self, entry, username: str) -> DirectoryIdentity:
        personnel_number = self._value(entry, self.settings.ldap_attribute_personnel_number)
        first_name = self._value(entry, self.settings.ldap_attribute_first_name)
        last_name = self._value(entry, self.settings.ldap_attribute_last_name)
        email = self._value(entry, self.settings.ldap_attribute_email) or None
        if not personnel_number or not personnel_number.isascii() or not personnel_number.isdigit():
            raise DirectoryIdentityError(
                "Konto katalogowe nie ma poprawnego, numerycznego numeru pracownika"
            )
        if not first_name:
            raise DirectoryIdentityError("Konto katalogowe nie ma imienia")
        if email is not None:
            try:
                validate_email(email, check_deliverability=False)
            except EmailNotValidError as exc:
                raise DirectoryIdentityError(
                    "Konto katalogowe nie ma poprawnego adresu e-mail"
                ) from exc
        if any(
            (
                len(username) > 120,
                len(personnel_number) > 32,
                len(first_name) > 120,
                len(last_name) > 120,
                email is not None and len(email) > 320,
            )
        ):
            raise DirectoryIdentityError("Atrybut konta katalogowego jest zbyt długi")
        return DirectoryIdentity(username, personnel_number, first_name, last_name, email)

    def _authenticate_sync(self, username: str, password: str) -> DirectoryIdentity | None:
        settings = self.settings
        if (
            not settings.ldap_bind_dn
            or settings.ldap_bind_password is None
            or not settings.ldap_base_dn
        ):
            raise DirectoryUnavailableError("Konfiguracja LDAP jest niepełna")
        template = settings.ldap_user_filter or DEFAULT_USER_FILTER
        if "{username}" not in template:
            raise DirectoryUnavailableError("Filtr LDAP nie zawiera pola {username}")
        search_filter = template.replace("{username}", escape_filter_chars(username))
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
        server = self._server()
        service: Connection | None = None
        try:
            service = self._connect(server, settings.ldap_bind_dn, settings.ldap_bind_password)
            if service is None:
                raise DirectoryUnavailableError("Konto serwisowe LDAP nie może się zalogować")
            searched = service.search(
                settings.ldap_base_dn,
                search_filter,
                search_scope=SUBTREE,
                attributes=attributes,
                size_limit=2,
            )
            if not searched:
                raise DirectoryUnavailableError("Wyszukiwanie LDAP nie powiodło się")
            if not service.entries:
                return None
            if len(service.entries) != 1:
                raise DirectoryUnavailableError("Filtr LDAP zwrócił więcej niż jedno konto")
            entry = service.entries[0]
            identity = self._identity(entry, username)
            user_dn = entry.entry_dn
        except DirectoryIdentityError:
            raise
        except DirectoryUnavailableError:
            raise
        except LDAPException as exc:
            raise DirectoryUnavailableError("Nie można połączyć się z katalogiem LDAP") from exc
        finally:
            if service is not None:
                service.unbind()

        user_connection: Connection | None = None
        try:
            user_connection = self._connect(server, user_dn, password)
            if user_connection is None:
                return None
        except LDAPInvalidCredentialsResult:
            return None
        except DirectoryUnavailableError:
            raise
        except LDAPException as exc:
            raise DirectoryUnavailableError("Nie można połączyć się z katalogiem LDAP") from exc
        finally:
            if user_connection is not None:
                user_connection.unbind()
        return identity


@lru_cache
def get_directory_authenticator() -> LdapAuthenticator:
    return LdapAuthenticator(get_settings())
