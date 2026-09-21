"""What the API log says about a sign-in, and what it never says.

The login endpoint writes one `event=login` record per attempt; a directory
attempt that stops short of an identity adds one `event=ldap_auth` record with
the same `attempt=` id. The answers the browser gets are the contract's and do
not change.
"""

import logging
import struct

import pytest
from sqlalchemy import select

from oncall import login_log
from oncall.bootstrap.http import configure_logging
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.ldap_auth import get_directory_authenticator
from oncall.main import app
from tests.conftest import TEST_PASSWORD, create_user
from tests.test_ldap_client import (
    ANNA_PASSWORD,
    SERVICE_DN,
    WRONG_PASSWORD,
    DirectoryLab,
    assert_no_secrets,
    bind_refused,
    records,
)


@pytest.fixture
def lab() -> DirectoryLab:
    lab = DirectoryLab()
    lab.add_anna()
    authenticator = lab.authenticator()
    app.dependency_overrides[get_directory_authenticator] = lambda: authenticator
    return lab


@pytest.fixture
def diagnostics(caplog):
    caplog.set_level(logging.INFO, logger="oncall")
    yield caplog
    assert_no_secrets(caplog)
    assert TEST_PASSWORD not in caplog.text


async def sign_in(client, username: str, password: str):
    return await client.post(
        "/api/v1/auth/login", json={"username": username, "password": password}
    )


async def test_a_directory_sign_in_is_one_quiet_line(client, db, lab, diagnostics) -> None:
    response = await sign_in(client, "anna", ANNA_PASSWORD)

    assert response.status_code == 200, response.text
    [record] = records(diagnostics)
    assert record | {"event": "login", "outcome": "signed_in", "source": "ldap"} == record
    assert record["level"] == "INFO"
    session_cookie = response.cookies.get("oncall_session")
    assert session_cookie and session_cookie not in diagnostics.text
    assert response.headers["x-csrf-token"] not in diagnostics.text


async def test_a_local_sign_in_is_one_quiet_line(client, db, lab, diagnostics) -> None:
    await create_user(db, "local")

    response = await sign_in(client, "local", TEST_PASSWORD)

    assert response.status_code == 200
    assert [(r["outcome"], r["source"], r["level"]) for r in records(diagnostics)] == [
        ("signed_in", "local", "INFO")
    ]


async def test_a_directory_outage_is_two_lines_of_one_attempt(client, db, lab, diagnostics):
    lab.fail("bind", bind_refused("52e"), dn=SERVICE_DN)

    response = await sign_in(client, "anna", ANNA_PASSWORD)

    # The browser's answer is unchanged: no phase, no reason.
    assert response.status_code == 503
    assert response.json() == {"detail": "Logowanie katalogowe jest chwilowo niedostępne"}
    directory, outcome = records(diagnostics)
    assert directory["attempt"] == outcome["attempt"]
    assert (directory["event"], directory["level"], directory["phase"], directory["reason"]) == (
        "ldap_auth",
        "WARNING",
        "service_bind",
        "invalidCredentials",
    )
    assert (outcome["event"], outcome["outcome"]) == ("login", "directory_unavailable")
    audit = await db.scalar(select(AuditEvent).where(AuditEvent.action == "auth.ldap_unavailable"))
    assert audit.details == {"reason": "Konto serwisowe LDAP nie może się zalogować"}


async def test_each_attempt_has_its_own_id(client, db, lab, diagnostics) -> None:
    await sign_in(client, "anna", WRONG_PASSWORD)
    await sign_in(client, "anna", WRONG_PASSWORD)

    attempts = [record["attempt"] for record in records(diagnostics)]
    assert len(attempts) == 4 and attempts[0] == attempts[1] != attempts[2] == attempts[3]


async def test_a_wrong_directory_password_says_so_only_in_the_log(client, db, lab, diagnostics):
    response = await sign_in(client, "anna", WRONG_PASSWORD)

    assert response.status_code == 401
    assert response.json() == {"detail": "Nieprawidłowy login lub hasło"}
    directory, outcome = records(diagnostics)
    assert (directory["outcome"], directory["phase"], directory["reason"]) == (
        "rejected",
        "user_bind",
        "invalidCredentials",
    )
    assert (outcome["outcome"], outcome["cause"]) == ("rejected", "credentials_rejected")


async def test_an_inactive_account_is_named_in_the_log_only(client, db, lab, diagnostics):
    retired = await create_user(db, "retired")
    retired.is_active = False
    await db.commit()

    response = await sign_in(client, "retired", TEST_PASSWORD)

    assert response.json() == {"detail": "Nieprawidłowy login lub hasło"}
    [outcome] = records(diagnostics)
    assert (outcome["outcome"], outcome["cause"]) == ("rejected", "account_inactive")


async def test_an_identity_conflict_is_a_warning_with_its_cause(client, db, lab, diagnostics):
    """The local `anna` has another personnel number, so the directory's
    `anna` cannot take it over - which an administrator has to resolve."""
    local = await create_user(db, "anna")
    local.personnel_number = "7"
    await db.commit()

    response = await sign_in(client, "anna", ANNA_PASSWORD)

    assert response.status_code == 409
    [outcome] = records(diagnostics)
    assert (outcome["level"], outcome["outcome"], outcome["cause"]) == (
        "WARNING",
        "identity_conflict",
        "personnel_number_mismatch",
    )


async def test_a_directory_account_without_mail_is_provisioned(client, db, diagnostics) -> None:
    lab = DirectoryLab()
    lab.add_anna(mail=None)
    authenticator = lab.authenticator()
    app.dependency_overrides[get_directory_authenticator] = lambda: authenticator

    response = await sign_in(client, "anna", ANNA_PASSWORD)

    assert response.status_code == 200, response.text
    user = await db.scalar(select(User).where(User.username == "anna"))
    assert user is not None and (user.email, user.display_name) == (None, "Anna Nowak")


async def test_an_unexpected_directory_error_is_an_outage_not_a_crash(client, db, lab, diagnostics):
    try:
        struct.pack("LL", 5.0, 0)
    except struct.error as exc:
        lab.fail("open", exc)

    response = await sign_in(client, "anna", ANNA_PASSWORD)

    assert response.status_code == 503
    assert [record["level"] for record in records(diagnostics)] == ["ERROR", "INFO"]


async def test_a_login_cannot_forge_a_log_record(client, db, lab, diagnostics) -> None:
    await sign_in(client, "anna\nevent=login outcome=signed_in", WRONG_PASSWORD)

    messages = [r.getMessage() for r in diagnostics.records if r.name == "oncall.login"]
    assert messages and all("\n" not in message for message in messages)
    assert all('login="anna\\nevent=login outcome=signed_in"' in m for m in messages)


def test_values_that_are_not_plain_words_are_quoted(caplog) -> None:
    caplog.set_level(logging.INFO, logger="oncall")

    login_log.emit("login", login='a "b"', outcome="rejected", cause=None)

    assert caplog.records[-1].getMessage() == 'event=login login="a \\"b\\"" outcome=rejected'


def test_the_api_process_logs_the_application_at_info_and_libraries_at_warning() -> None:
    application = logging.getLogger("oncall")
    before = application.level
    try:
        configure_logging()
        assert application.getEffectiveLevel() == logging.INFO
        # SQLAlchemy at INFO would log statements with their parameters.
        assert logging.getLogger("sqlalchemy.engine").getEffectiveLevel() >= logging.WARNING
    finally:
        application.setLevel(before)
