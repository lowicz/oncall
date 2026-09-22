from dataclasses import replace

import pytest
from sqlalchemy import select

from oncall.config import Settings
from oncall.domain.vocabulary import AuthSource, UserRole
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.team_models import TeamMember
from oncall.ldap_auth import (
    DirectoryIdentity,
    DirectoryPhoto,
    DirectoryUnavailableError,
    get_directory_authenticator,
)
from oncall.main import app
from oncall.routes import access
from tests.conftest import create_member, create_user, login

AVATAR_URL = "/api/v1/auth/me/avatar"
JPEG_PHOTO = b"\xff\xd8\xff\xe0" + bytes(range(256))


class FakeDirectory:
    def __init__(
        self,
        identity: DirectoryIdentity | None = None,
        error: Exception | None = None,
        photo: DirectoryPhoto | None = None,
    ) -> None:
        self.identity = identity
        self.error = error
        self.stored_photo = photo
        self.calls: list[tuple[str, str]] = []
        self.photo_calls: list[str] = []

    async def authenticate(self, username: str, password: str) -> DirectoryIdentity | None:
        self.calls.append((username, password))
        if self.error:
            raise self.error
        return self.identity

    async def photo(self, username: str) -> DirectoryPhoto | None:
        self.photo_calls.append(username)
        if self.error:
            raise self.error
        return self.stored_photo


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


def offer_photos(monkeypatch: pytest.MonkeyPatch) -> None:
    """The deployment reads photos: the directory is on, with the default
    photo attribute."""
    monkeypatch.setattr(access, "get_settings", lambda: Settings(ldap_enabled=True))


async def directory_login(client) -> dict:
    response = await client.post(
        "/api/v1/auth/login", json={"username": "anna", "password": "directory-secret"}
    )
    assert response.status_code == 200, response.text
    return response.json()


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


async def test_a_directory_account_is_shown_its_own_photo_read_on_request(
    client, db, monkeypatch
) -> None:
    offer_photos(monkeypatch)
    directory = FakeDirectory(directory_identity(), photo=DirectoryPhoto("image/jpeg", JPEG_PHOTO))
    use_directory(directory)

    signed_in = await directory_login(client)
    current = await client.get("/api/v1/auth/me")
    avatar = await client.get(AVATAR_URL)

    assert signed_in["avatar_url"] == AVATAR_URL
    assert current.json()["avatar_url"] == AVATAR_URL
    assert avatar.status_code == 200, avatar.text
    assert avatar.headers["content-type"] == "image/jpeg"
    # Never kept by the browser: the next person on the same computer must
    # not be shown this face out of its cache.
    assert avatar.headers["cache-control"] == "no-store"
    assert avatar.content == JPEG_PHOTO
    # Asked in the person's own name only, and only once signing in is done.
    assert directory.photo_calls == ["anna"]


async def test_a_local_account_has_no_avatar_and_the_directory_is_not_asked(
    client, db, monkeypatch
) -> None:
    offer_photos(monkeypatch)
    await create_user(db, "local")
    directory = FakeDirectory(photo=DirectoryPhoto("image/jpeg", JPEG_PHOTO))
    use_directory(directory)

    signed_in = await login(client, "local")
    avatar = await client.get(AVATAR_URL)

    assert signed_in["avatar_url"] is None
    assert avatar.status_code == 404
    assert directory.photo_calls == []


async def test_a_deployment_without_directory_photos_offers_no_avatar(client, db) -> None:
    """The default settings: no directory, so no photo attribute to read even
    for an account that signed in through the directory."""
    directory = FakeDirectory(directory_identity(), photo=DirectoryPhoto("image/jpeg", JPEG_PHOTO))
    use_directory(directory)

    signed_in = await directory_login(client)

    assert signed_in["avatar_url"] is None


async def test_a_directory_account_without_a_photo_keeps_the_initials(
    client, db, monkeypatch
) -> None:
    offer_photos(monkeypatch)
    use_directory(FakeDirectory(directory_identity(), photo=None))

    signed_in = await directory_login(client)
    avatar = await client.get(AVATAR_URL)

    # The answer says a photo may exist; only the fetch finds out it does not.
    assert signed_in["avatar_url"] == AVATAR_URL
    assert avatar.status_code == 404
    assert avatar.json() == {"detail": "Brak zdjęcia w katalogu"}


async def test_a_directory_outage_while_reading_the_photo_is_one_generic_answer(
    client, db, monkeypatch
) -> None:
    offer_photos(monkeypatch)
    directory = FakeDirectory(directory_identity())
    use_directory(directory)
    await directory_login(client)
    directory.error = DirectoryUnavailableError(
        "Konto serwisowe LDAP nie może się zalogować",
        phase="service_bind",
        reason="invalidCredentials",
    )

    avatar = await client.get(AVATAR_URL)

    assert avatar.status_code == 503
    # The client's own message, which names the service account, stays in
    # the log; the browser learns only that the directory did not answer.
    assert avatar.json() == {"detail": "Katalog jest chwilowo niedostępny"}


async def test_the_avatar_needs_a_session(client) -> None:
    assert (await client.get(AVATAR_URL)).status_code == 401
