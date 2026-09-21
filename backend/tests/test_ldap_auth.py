from dataclasses import replace
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from oncall.config import Settings
from oncall.domain.vocabulary import AuthSource, UserRole
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.team_models import TeamMember
from oncall.ldap_auth import (
    DirectoryIdentity,
    DirectoryIdentityError,
    DirectoryUnavailableError,
    LdapAuthenticator,
    get_directory_authenticator,
)
from oncall.main import app
from tests.conftest import create_member, create_user, login


class FakeDirectory:
    def __init__(
        self,
        identity: DirectoryIdentity | None = None,
        error: Exception | None = None,
    ) -> None:
        self.identity = identity
        self.error = error
        self.calls: list[tuple[str, str]] = []

    async def authenticate(self, username: str, password: str) -> DirectoryIdentity | None:
        self.calls.append((username, password))
        if self.error:
            raise self.error
        return self.identity


def directory_identity(**changes) -> DirectoryIdentity:
    identity = DirectoryIdentity(
        username="anna",
        personnel_number="000042",
        first_name="Anna",
        last_name="Nowak",
        email="anna@example.com",
    )
    return replace(identity, **changes)


def use_directory(directory: FakeDirectory) -> None:
    app.dependency_overrides[get_directory_authenticator] = lambda: directory


async def test_first_ldap_login_provisions_viewer_and_is_audited(client, db) -> None:
    directory = FakeDirectory(directory_identity())
    use_directory(directory)

    response = await client.post(
        "/api/v1/auth/login", json={"username": "anna", "password": "directory-secret"}
    )

    assert response.status_code == 200, response.text
    assert response.json()["role"] == "viewer"
    user = await db.scalar(select(User).where(User.personnel_number == "000042"))
    assert user is not None
    assert user.auth_source == AuthSource.ldap
    assert user.password_hash is None
    assert user.role == UserRole.viewer
    actions = set(await db.scalars(select(AuditEvent.action)))
    assert {"auth.ldap_provisioned", "auth.login"} <= actions


async def test_ldap_login_synchronizes_identity_but_keeps_local_authorization(client, db) -> None:
    user = User(
        username="anna",
        personnel_number="000042",
        first_name="Anna",
        last_name="Nowak",
        email="old@example.com",
        auth_source=AuthSource.ldap,
        password_hash=None,
        role=UserRole.coordinator,
        is_active=True,
    )
    db.add(user)
    await db.commit()
    await create_member(db, user, display_name="Anna Nowak")
    directory = FakeDirectory(
        directory_identity(last_name="Nowak-Kowalska", email="new@example.com")
    )
    use_directory(directory)

    response = await client.post(
        "/api/v1/auth/login", json={"username": "anna", "password": "directory-secret"}
    )

    assert response.status_code == 200, response.text
    assert response.json()["role"] == "coordinator"
    await db.refresh(user)
    member = await db.scalar(select(TeamMember).where(TeamMember.user_id == user.id))
    assert user.display_name == "Anna Nowak-Kowalska"
    assert user.email == "new@example.com"
    assert member is not None and member.display_name == "Anna Nowak-Kowalska"
    assert "auth.ldap_synced" in set(await db.scalars(select(AuditEvent.action)))


@pytest.mark.parametrize("username", ["bad-password", "outside-directory"])
async def test_rejected_directory_login_does_not_create_an_account(client, db, username) -> None:
    directory = FakeDirectory(None)
    use_directory(directory)

    response = await client.post(
        "/api/v1/auth/login", json={"username": username, "password": "wrong-password"}
    )

    assert response.status_code == 401
    assert await db.scalar(select(User.id)) is None


async def test_directory_failure_does_not_block_local_login_or_existing_session(client, db) -> None:
    await create_user(db, "local")
    directory = FakeDirectory(error=DirectoryUnavailableError("connection refused"))
    use_directory(directory)

    await login(client, "local")
    unavailable = await client.post(
        "/api/v1/auth/login", json={"username": "ldap-user", "password": "some-password"}
    )
    current = await client.get("/api/v1/auth/me")

    assert unavailable.status_code == 503
    assert current.status_code == 200
    assert current.json()["username"] == "local"
    assert directory.calls == [("ldap-user", "some-password")]


async def test_failed_local_password_falls_back_to_directory_without_takeover(client, db) -> None:
    """A wrong local password tries AD, but a mismatched personnel number blocks
    the link: the directory identity must not hijack the local account."""
    await create_user(db, "local")  # no personnel number
    directory = FakeDirectory(directory_identity(username="local"))
    use_directory(directory)

    response = await client.post(
        "/api/v1/auth/login", json={"username": "local", "password": "wrong-password"}
    )

    assert response.status_code == 409
    assert directory.calls == [("local", "wrong-password")]
    assert "auth.ldap_identity_conflict" in set(await db.scalars(select(AuditEvent.action)))


async def test_local_account_links_with_directory_on_personnel_number_match(client, db) -> None:
    """The intended flow: admin creates a local account with the AD personnel
    number, the person's first directory login links it and clears the local
    password. Role, activity and rotation survive."""
    local = await create_user(db, "local", role=UserRole.coordinator)
    local.personnel_number = "000042"
    await db.commit()
    await create_member(db, local, display_name="Anna Nowak")
    directory = FakeDirectory(directory_identity(username="directory-user"))
    use_directory(directory)

    response = await client.post(
        "/api/v1/auth/login",
        json={"username": "directory-user", "password": "directory-secret"},
    )

    assert response.status_code == 200, response.text
    assert response.json()["role"] == "coordinator"
    await db.refresh(local)
    assert local.auth_source == AuthSource.ldap
    assert local.password_hash is None
    assert local.username == "directory-user"
    member = await db.scalar(select(TeamMember).where(TeamMember.user_id == local.id))
    assert member is not None
    actions = set(await db.scalars(select(AuditEvent.action)))
    assert {"auth.ldap_linked", "auth.login"} <= actions


async def test_linked_account_logs_in_with_directory_password_next_time(client, db) -> None:
    local = await create_user(db, "local")
    local.personnel_number = "000042"
    await db.commit()
    directory = FakeDirectory(directory_identity(username="directory-user"))
    use_directory(directory)

    first = await client.post(
        "/api/v1/auth/login",
        json={"username": "directory-user", "password": "directory-secret"},
    )
    assert first.status_code == 200
    # The old local password no longer works once the account is linked: only
    # the directory decides, and the directory rejects this one.
    use_directory(FakeDirectory(None))
    client.cookies.clear()
    old_password = await client.post(
        "/api/v1/auth/login", json={"username": "directory-user", "password": "test-password-123"}
    )
    assert old_password.status_code == 401


async def test_linking_via_matching_username_and_personnel_number(client, db) -> None:
    """Same username locally and in AD: the local password fails, the directory
    password succeeds, and the personnel-number match links the account."""
    local = await create_user(db, "anna")
    local.personnel_number = "000042"
    await db.commit()
    directory = FakeDirectory(directory_identity(username="anna"))
    use_directory(directory)

    response = await client.post(
        "/api/v1/auth/login", json={"username": "anna", "password": "directory-secret"}
    )

    assert response.status_code == 200, response.text
    await db.refresh(local)
    assert local.auth_source == AuthSource.ldap
    assert local.password_hash is None


async def test_directory_identity_cannot_link_when_username_is_taken_elsewhere(client, db) -> None:
    local = await create_user(db, "local")
    local.personnel_number = "000042"
    await db.commit()
    await create_user(db, "directory-user")
    directory = FakeDirectory(directory_identity(username="directory-user"))
    use_directory(directory)

    response = await client.post(
        "/api/v1/auth/login",
        json={"username": "directory-user", "password": "directory-secret"},
    )

    assert response.status_code == 409
    await db.refresh(local)
    assert local.auth_source == AuthSource.local


class FakeLdapConnection:
    def __init__(self, entries=None, search_succeeds=True) -> None:
        self.entries = entries or []
        self.search_succeeds = search_succeeds
        self.search_filter: str | None = None
        self.unbound = False

    def search(self, _base, search_filter, **_kwargs) -> bool:
        self.search_filter = search_filter
        return self.search_succeeds

    def unbind(self) -> None:
        self.unbound = True


class StubLdapAuthenticator(LdapAuthenticator):
    def __init__(self, connections) -> None:
        super().__init__(
            Settings(
                ldap_enabled=True,
                ldap_server_uri="ldap://directory.example.com",
                ldap_bind_dn="cn=service,dc=example,dc=com",
                ldap_bind_password="service-secret",
                ldap_base_dn="dc=example,dc=com",
            )
        )
        self.connections = iter(connections)

    def _server(self):
        return SimpleNamespace(ssl=False)

    def _connect(self, _server, _user, _password):
        return next(self.connections)


def ldap_entry(**attributes):
    values = {
        "employeeNumber": ["000042"],
        "givenName": ["Anna"],
        "sn": ["Nowak"],
        "mail": ["anna@example.com"],
    }
    values.update(attributes)
    return SimpleNamespace(
        entry_dn="cn=Anna,dc=example,dc=com",
        entry_attributes_as_dict=values,
    )


def test_ldap_client_escapes_login_in_the_search_filter_and_binds_as_user() -> None:
    service = FakeLdapConnection([ldap_entry()])
    user_bind = FakeLdapConnection()
    authenticator = StubLdapAuthenticator([service, user_bind])

    identity = authenticator._authenticate_sync("anna*)(uid=*)", "directory-secret")

    assert identity is not None and identity.personnel_number == "000042"
    assert service.search_filter == (
        "(&(objectClass=user)(sAMAccountName=anna\\2a\\29\\28uid=\\2a\\29))"
    )
    assert service.unbound and user_bind.unbound


def test_ldap_client_rejects_invalid_directory_identity() -> None:
    service = FakeLdapConnection([ldap_entry(employeeNumber=["ABC"])])
    authenticator = StubLdapAuthenticator([service])

    with pytest.raises(DirectoryIdentityError, match="numeru pracownika"):
        authenticator._authenticate_sync("anna", "directory-secret")
