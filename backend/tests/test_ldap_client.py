"""The LDAP client against a directory shaped like Active Directory.

`DirectoryLab` is ldap3's own in-memory strategy: the entries, the attribute
dictionary (keyed by the directory's spelling, an absent attribute as `[]`)
and the errors are the library's, as they are against a real server; only the
socket is missing. The two socket tests at the end supply one, because the
defect that stopped every directory sign-in lived there.

Every test that logs checks the records for the secrets it handed over: the
passwords, the service account's DN and the person's entry.
"""

import logging
import re
import socket
import struct
import threading
from collections.abc import Iterator
from pathlib import Path

import pytest
from ldap3 import MOCK_SYNC, NONE, Connection, Server
from ldap3.core.exceptions import (
    LDAPInvalidCredentialsResult,
    LDAPSocketOpenError,
    LDAPStartTLSError,
    LDAPStrongerAuthRequiredResult,
)

from oncall.config import Settings
from oncall.ldap_auth import (
    DirectoryIdentity,
    DirectoryIdentityError,
    DirectoryUnavailableError,
    LdapAuthenticator,
)

BASE_DN = "DC=corp,DC=example,DC=com"
SERVICE_DN = "CN=Oncall Service,CN=Users,DC=corp,DC=example,DC=com"
SERVICE_PASSWORD = "svc-Secret-7f3a"
ANNA_DN = "CN=Anna Nowak,OU=Staff,DC=corp,DC=example,DC=com"
ANNA_PASSWORD = "anna-Secret-91c2"
WRONG_PASSWORD = "wrong-Secret-5d1e"
#: What no log record may contain: credentials, DNs and attribute values.
SECRETS = (SERVICE_PASSWORD, ANNA_PASSWORD, WRONG_PASSWORD, "Oncall Service", "OU=Staff")
PERSONAL_DATA = ("Nowak", "000042", "anna@corp.example.com")

#: Wording recorded from a Samba Active Directory domain controller and
#: Python's ssl module, so the classification is tested on what they send.
AD_BIND_REFUSED = (
    "80090308: LdapErr: DSID-0C0903A9, comment: AcceptSecurityContext error, data {code}, v1db1"
)
UNTRUSTED_CA = (
    "wrap socket error: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: "
    "unable to get local issuer certificate (_ssl.c:1082)"
)
NAME_MISMATCH = (
    "wrap socket error: certificate {'subject': ((('commonName', 'dc1.corp.example.com'),),), "
    "'subjectAltName': (('DNS', 'dc1.corp.example.com'),)} doesn't match any name in "
    "['172.20.0.2'] "
)


def bind_refused(code: str) -> LDAPInvalidCredentialsResult:
    return LDAPInvalidCredentialsResult(
        result=49,
        description="invalidCredentials",
        message=AD_BIND_REFUSED.format(code=code),
        response_type="bindResponse",
    )


class DirectoryLab:
    def __init__(self) -> None:
        self.server = Server("dc1.corp.example.com", get_info=NONE)
        self._seed = Connection(self.server, client_strategy=MOCK_SYNC)
        #: (DN or "*", operation) -> the error that operation raises.
        self.failures: dict[tuple[str, str], BaseException] = {}
        self.add(SERVICE_DN, sAMAccountName="oncall-service", userPassword=SERVICE_PASSWORD)

    def add(self, dn: str, **attributes: object) -> None:
        self._seed.strategy.add_entry(dn, {"objectClass": ["top", "person", "user"], **attributes})

    def add_anna(self, **attributes: object) -> None:
        values: dict[str, object] = {
            "sAMAccountName": "anna",
            "userPassword": ANNA_PASSWORD,
            "employeeNumber": "000042",
            "givenName": "Anna",
            "sn": "Nowak",
            "mail": "anna@corp.example.com",
        }
        values.update(attributes)
        self.add(ANNA_DN, **{name: value for name, value in values.items() if value is not None})

    def fail(self, operation: str, error: BaseException, dn: str = "*") -> None:
        self.failures[(dn, operation)] = error

    def authenticator(self, **overrides: object) -> LdapAuthenticator:
        settings = Settings(
            **{
                "ldap_enabled": True,
                "ldap_server_uri": "ldaps://dc1.corp.example.com",
                "ldap_bind_dn": SERVICE_DN,
                "ldap_bind_password": SERVICE_PASSWORD,
                "ldap_base_dn": BASE_DN,
                **overrides,
            }
        )
        lab = self

        class LabAuthenticator(LdapAuthenticator):
            def _connection(self, server: Server, user: str, password: str) -> Connection:
                connection = Connection(
                    lab.server,
                    user=user,
                    password=password,
                    client_strategy=MOCK_SYNC,
                    raise_exceptions=True,
                )
                for operation in ("open", "start_tls", "bind", "search"):
                    error = lab.failures.get((user, operation)) or lab.failures.get(
                        ("*", operation)
                    )
                    if error is not None:
                        setattr(connection, operation, _raising(error))
                return connection

        return LabAuthenticator(settings)


def _raising(error: BaseException):
    def operation(*_args, **_kwargs):
        raise error

    return operation


def records(caplog) -> list[dict[str, str]]:
    """The sign-in records, each parsed back from logfmt."""
    parsed = []
    for record in caplog.records:
        if record.name != "oncall.login":
            continue
        fields = {
            name: value.strip('"')
            for name, value in re.findall(r'(\w+)=("(?:[^"\\]|\\.)*"|\S+)', record.getMessage())
        }
        parsed.append(fields | {"level": record.levelname})
    return parsed


def assert_no_secrets(caplog) -> None:
    text = "\n".join(record.getMessage() for record in caplog.records)
    for secret in SECRETS + PERSONAL_DATA:
        assert secret not in text


@pytest.fixture
def lab() -> DirectoryLab:
    return DirectoryLab()


@pytest.fixture
def diagnostics(caplog):
    caplog.set_level(logging.INFO, logger="oncall")
    yield caplog
    assert_no_secrets(caplog)


def test_a_directory_account_signs_in_and_logs_nothing(lab, diagnostics) -> None:
    lab.add_anna()

    identity = lab.authenticator()._authenticate_sync("anna", ANNA_PASSWORD)

    assert identity == DirectoryIdentity("anna", "000042", "Anna", "Nowak", "anna@corp.example.com")
    assert records(diagnostics) == []


def test_the_login_is_escaped_in_the_search_filter(lab, diagnostics) -> None:
    lab.add_anna()
    authenticator = lab.authenticator()

    _, _, _, search_filter = authenticator._search_settings("anna*)(uid=*)")
    identity = authenticator._authenticate_sync("anna*)(uid=*)", ANNA_PASSWORD)

    assert search_filter == "(&(objectClass=user)(sAMAccountName=anna\\2a\\29\\28uid=\\2a\\29))"
    assert identity is None
    assert records(diagnostics)[0]["reason"] == "user_not_found"


@pytest.mark.parametrize(
    ("setup", "phase", "reason", "details"),
    [
        ("wrong_password", "user_bind", "invalidCredentials", {}),
        ("unknown_login", "search", "user_not_found", {}),
        # A base DN under an organisational unit returns no referrals, so an
        # unknown login comes back as an empty response - which ldap3 reports
        # as a failed search. It is a rejected login all the same.
        ("unknown_login_under_ou", "search", "user_not_found", {}),
        ("locked", "user_bind", "invalidCredentials", {"ad_code": "775"}),
        ("password_expired", "user_bind", "invalidCredentials", {"ad_reason": "password_expired"}),
    ],
)
def test_a_rejected_login_says_where_and_why(lab, diagnostics, setup, phase, reason, details):
    lab.add_anna()
    overrides: dict[str, object] = {}
    login, password = "anna", ANNA_PASSWORD
    if setup == "wrong_password":
        password = WRONG_PASSWORD
    elif setup == "unknown_login":
        login = "nobody"
    elif setup == "unknown_login_under_ou":
        login, overrides = "nobody", {"ldap_base_dn": "OU=Staff,DC=corp,DC=example,DC=com"}
    elif setup == "locked":
        lab.fail("bind", bind_refused("775"), dn=ANNA_DN)
    elif setup == "password_expired":
        lab.fail("bind", bind_refused("532"), dn=ANNA_DN)

    assert lab.authenticator(**overrides)._authenticate_sync(login, password) is None

    [record] = records(diagnostics)
    assert record | {"phase": phase, "reason": reason, **details} == record
    assert (record["event"], record["outcome"], record["level"]) == (
        "ldap_auth",
        "rejected",
        "INFO",
    )
    assert (record["login"], record["server"]) == (login, "ldaps://dc1.corp.example.com:636")


@pytest.mark.parametrize(
    ("setup", "phase", "reason", "details"),
    [
        (
            "service_password",
            "service_bind",
            "invalidCredentials",
            {"ad_reason": "invalid_credentials"},
        ),
        ("service_password_expired", "service_bind", "invalidCredentials", {"ad_code": "532"}),
        ("plain_ldap_without_tls", "service_bind", "strongerAuthRequired", {}),
        ("start_tls_refused", "tls", "unwillingToPerform", {}),
        (
            "untrusted_ca",
            "tls",
            "certificate_verify_failed",
            {"detail": "unable to get local issuer certificate"},
        ),
        ("untrusted_ca_ldaps", "tls", "certificate_verify_failed", {}),
        ("name_mismatch", "tls", "certificate_name_mismatch", {}),
        ("refused_on_every_address", "connect", "connection_refused", {}),
        ("base_dn", "search", "noSuchObject", {}),
        ("filter_syntax", "search", "invalid_filter", {}),
        ("two_entries", "search", "multiple_entries", {}),
        (
            "empty_bind_password",
            "config",
            "settings_missing",
            {"missing": "ONCALL_LDAP_BIND_PASSWORD"},
        ),
        ("filter_placeholder", "config", "filter_without_username", {}),
        ("server_uri", "config", "server_uri_invalid", {}),
        ("ca_file", "config", "ca_file_unreadable", {"detail": "/nonexistent/ca.pem"}),
    ],
)
def test_a_directory_failure_says_where_and_why(lab, diagnostics, setup, phase, reason, details):
    lab.add_anna()
    overrides: dict[str, object] = {}
    if setup == "service_password":
        lab.fail("bind", bind_refused("52e"), dn=SERVICE_DN)
    elif setup == "service_password_expired":
        lab.fail("bind", bind_refused("532"), dn=SERVICE_DN)
    elif setup == "plain_ldap_without_tls":
        overrides = {"ldap_server_uri": "ldap://dc1.corp.example.com", "ldap_start_tls": False}
        lab.fail(
            "bind",
            LDAPStrongerAuthRequiredResult(
                result=8,
                description="strongerAuthRequired",
                message="BindSimple: Transport encryption required.",
                response_type="bindResponse",
            ),
        )
    elif setup == "start_tls_refused":
        # ldap3's in-memory server answers StartTLS the way a server without
        # a certificate does: unwillingToPerform.
        overrides = {"ldap_server_uri": "ldap://dc1.corp.example.com"}
    elif setup == "untrusted_ca":
        overrides = {"ldap_server_uri": "ldap://dc1.corp.example.com"}
        lab.fail("start_tls", LDAPStartTLSError(UNTRUSTED_CA))
    elif setup == "untrusted_ca_ldaps":
        lab.fail(
            "open", LDAPSocketOpenError(UNTRUSTED_CA.replace("wrap socket", "socket ssl wrapping"))
        )
    elif setup == "name_mismatch":
        overrides = {"ldap_server_uri": "ldap://dc1.corp.example.com"}
        lab.fail("start_tls", LDAPStartTLSError(NAME_MISMATCH))
    elif setup == "refused_on_every_address":
        refused = LDAPSocketOpenError(
            "socket connection error while opening: [Errno 111] Connection refused"
        )
        lab.fail(
            "open",
            LDAPSocketOpenError(
                "unable to open socket",
                [(refused, ("10.0.0.1", 636)), (refused, ("10.0.0.2", 636))],
            ),
        )
    elif setup == "base_dn":
        overrides = {"ldap_base_dn": "OU=Nope,DC=corp,DC=example,DC=com"}
    elif setup == "filter_syntax":
        overrides = {"ldap_user_filter": "(&(objectClass=user)(sAMAccountName={username})"}
    elif setup == "two_entries":
        lab.add("CN=Anna Kowalska,CN=Users,DC=corp,DC=example,DC=com", sAMAccountName="anna")
    elif setup == "empty_bind_password":
        overrides = {"ldap_bind_password": ""}
    elif setup == "filter_placeholder":
        overrides = {"ldap_user_filter": "(sAMAccountName=anna)"}
    elif setup == "server_uri":
        overrides = {"ldap_server_uri": "dc1.corp.example.com"}
    elif setup == "ca_file":
        overrides = {"ldap_ca_file": "/nonexistent/ca.pem"}

    with pytest.raises(DirectoryUnavailableError) as failure:
        lab.authenticator(**overrides)._authenticate_sync("anna", ANNA_PASSWORD)

    assert (failure.value.phase, failure.value.reason) == (phase, reason)
    [record] = records(diagnostics)
    assert record | {"phase": phase, "reason": reason, **details} == record
    assert (record["outcome"], record["level"]) == ("unavailable", "WARNING")
    # The certificate itself, which ldap3 quotes whole, is not repeated.
    assert "subjectAltName" not in record.get("detail", "")


def test_the_audit_reason_names_the_phase_not_a_connection_failure(lab) -> None:
    lab.add_anna()
    lab.fail("bind", bind_refused("52e"), dn=SERVICE_DN)

    with pytest.raises(DirectoryUnavailableError) as failure:
        lab.authenticator()._authenticate_sync("anna", ANNA_PASSWORD)

    assert str(failure.value) == "Konto serwisowe LDAP nie może się zalogować"


def test_an_unexpected_client_error_is_an_outage_that_names_its_origin(lab, diagnostics):
    lab.add_anna()
    try:
        struct.pack("LL", 5.0, 0)
    except struct.error as exc:
        error = exc

    lab.fail("open", error)
    with pytest.raises(DirectoryUnavailableError) as failure:
        lab.authenticator()._authenticate_sync("anna", ANNA_PASSWORD)

    assert (failure.value.phase, failure.value.reason) == ("connect", "unexpected_error")
    [record] = records(diagnostics)
    assert (record["level"], record["error"]) == ("ERROR", "struct.error")
    assert re.fullmatch(r".*tests/test_ldap_client\.py:\d+", record["at"])
    # The exception's own text is left out: it could quote the input.
    assert "integer" not in diagnostics.text


@pytest.mark.parametrize("configured", ["employeeID", "employeeid", "EMPLOYEEID"])
def test_attribute_names_match_without_regard_to_case(lab, configured) -> None:
    lab.add_anna(employeeNumber=None, employeeID="000043")

    identity = lab.authenticator(
        ldap_attribute_personnel_number=configured, ldap_attribute_first_name="givenname"
    )._authenticate_sync("anna", ANNA_PASSWORD)

    assert identity is not None
    assert (identity.personnel_number, identity.first_name) == ("000043", "Anna")


def test_an_account_without_optional_attributes_still_signs_in(lab, diagnostics) -> None:
    """Many Active Directory accounts have no `mail` and some no `sn`: they
    are optional here, and an absent value is empty - not the text '[]'."""
    lab.add_anna(mail=None, sn=None)

    identity = lab.authenticator()._authenticate_sync("anna", ANNA_PASSWORD)

    assert identity == DirectoryIdentity("anna", "000042", "Anna", "", None)
    assert records(diagnostics) == []


@pytest.mark.parametrize(
    ("attributes", "reason", "attribute"),
    [
        ({"employeeNumber": None}, "personnel_number_missing", "employeeNumber"),
        ({"employeeNumber": "E-42"}, "personnel_number_not_numeric", "employeeNumber"),
        ({"givenName": None}, "first_name_missing", "givenName"),
        ({"mail": "not-an-address"}, "email_invalid", "mail"),
        ({"sn": "N" * 121}, "attribute_too_long", "sn"),
    ],
)
def test_an_unusable_entry_names_the_attribute_not_its_value(
    lab, diagnostics, attributes, reason, attribute
) -> None:
    lab.add_anna(**attributes)

    with pytest.raises(DirectoryIdentityError) as failure:
        lab.authenticator()._authenticate_sync("anna", ANNA_PASSWORD)

    assert (failure.value.reason, failure.value.attribute) == (reason, attribute)
    [record] = records(diagnostics)
    assert (record["outcome"], record["phase"], record["reason"], record["attribute"]) == (
        "invalid_identity",
        "attributes",
        reason,
        attribute,
    )
    assert "E-42" not in diagnostics.text and "not-an-address" not in diagnostics.text


def test_an_unusable_entry_with_a_wrong_password_is_a_wrong_password(lab, diagnostics) -> None:
    """The entry is judged only once the password is proven, so a wrong
    password gets the wrong-password answer whatever the entry holds."""
    lab.add_anna(employeeNumber=None)

    assert lab.authenticator()._authenticate_sync("anna", WRONG_PASSWORD) is None
    [record] = records(diagnostics)
    assert (record["phase"], record["reason"]) == ("user_bind", "invalidCredentials")


def test_the_ca_file_is_the_trust_anchor_for_the_directory(tmp_path: Path) -> None:
    ca_file = tmp_path / "ldap-ca.pem"
    ca_file.write_text("-----BEGIN CERTIFICATE-----\n")
    authenticator = LdapAuthenticator(
        Settings(ldap_server_uri="ldaps://dc1.corp.example.com", ldap_ca_file=str(ca_file))
    )

    server = authenticator._server()

    assert server.ssl and server.tls.ca_certs_file == str(ca_file)


@pytest.fixture
def hanging_up_server() -> Iterator[int]:
    """A TCP server that accepts and hangs up: reachable, but no directory."""
    listener = socket.create_server(("127.0.0.1", 0))
    stop = threading.Event()

    def serve() -> None:
        listener.settimeout(0.1)
        while not stop.is_set():
            try:
                connection, _ = listener.accept()
            except TimeoutError:
                continue
            connection.close()

    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    yield listener.getsockname()[1]
    stop.set()
    thread.join()
    listener.close()


def test_a_reachable_server_is_opened_with_the_default_timeout(hanging_up_server, caplog):
    """The regression that stopped every directory sign-in: the default
    timeout is 5.0, ldap3 packs the receive timeout as an integer, and the
    float failed with `struct.error` the moment the socket connected. Past
    that, this server hangs up at StartTLS - the phase after the connection."""
    caplog.set_level(logging.INFO, logger="oncall")
    authenticator = LdapAuthenticator(
        Settings(
            ldap_enabled=True,
            ldap_server_uri=f"ldap://127.0.0.1:{hanging_up_server}",
            ldap_bind_dn=SERVICE_DN,
            ldap_bind_password=SERVICE_PASSWORD,
            ldap_base_dn=BASE_DN,
        )
    )
    assert authenticator.settings.ldap_connect_timeout_seconds == 5.0

    with pytest.raises(DirectoryUnavailableError) as failure:
        authenticator._authenticate_sync("anna", ANNA_PASSWORD)

    assert failure.value.phase == "tls"
    assert failure.value.reason != "unexpected_error"
    assert_no_secrets(caplog)


def test_a_closed_port_is_a_refused_connection(caplog) -> None:
    probe = socket.create_server(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()
    authenticator = LdapAuthenticator(
        Settings(
            ldap_enabled=True,
            ldap_server_uri=f"ldap://127.0.0.1:{port}",
            ldap_bind_dn=SERVICE_DN,
            ldap_bind_password=SERVICE_PASSWORD,
            ldap_base_dn=BASE_DN,
            ldap_connect_timeout_seconds=1,
        )
    )

    with pytest.raises(DirectoryUnavailableError) as failure:
        authenticator._authenticate_sync("anna", ANNA_PASSWORD)

    assert (failure.value.phase, failure.value.reason) == ("connect", "connection_refused")
