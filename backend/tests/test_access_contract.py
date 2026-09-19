"""Signing in, one-time links and calendar feeds, pinned before their rules
moved into the domain: statuses, messages, headers, and what stays stored
after a refusal."""

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import func, select, update

from oncall.auth import hash_password, token_hash
from oncall.ldap_auth import (
    DirectoryIdentityError,
    DirectoryUnavailableError,
    get_directory_authenticator,
)
from oncall.main import app
from oncall.models import (
    AccountToken,
    AccountTokenKind,
    AuditEvent,
    AuthSource,
    CalendarFeedToken,
    Session,
    ShareLink,
    User,
    UserRole,
)
from tests.conftest import (
    TEST_PASSWORD,
    create_member,
    create_published_schedule,
    create_user,
    login,
)
from tests.test_ldap_auth import FakeDirectory, directory_identity

TODAY = date.today()


def assert_error(response, status_code: int, detail) -> None:
    assert (response.status_code, response.json()["detail"]) == (status_code, detail)


async def _actions(db) -> list[tuple[str, str]]:
    rows = await db.execute(
        select(AuditEvent.action, AuditEvent.actor_label).order_by(AuditEvent.occurred_at)
    )
    return [tuple(row) for row in rows]


@pytest.fixture(autouse=True)
def no_directory():
    app.dependency_overrides[get_directory_authenticator] = lambda: FakeDirectory()
    yield


async def test_share_link_lifecycle(client, db) -> None:
    admin = await create_user(db, "admin", role=UserRole.admin, display_name="Ada Admin")
    await login(client, "admin")

    created = await client.post(
        "/api/v1/admin/share-links",
        json={
            "label": "Piotr",
            "starts_on": TODAY.isoformat(),
            "ends_on": (TODAY + timedelta(days=3)).isoformat(),
            "expires_days": 2,
        },
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert set(body) == {"id", "url", "expires_at"}
    raw = body["url"].rsplit("/share/", 1)[1]
    expires_at = datetime.fromisoformat(body["expires_at"])
    assert (
        timedelta(days=1, hours=23)
        < expires_at.replace(tzinfo=UTC) - datetime.now(UTC)
        <= timedelta(days=2)
    )
    link = await db.scalar(select(ShareLink))
    assert (link.id, link.created_by_id, link.token_hash) == (
        uuid.UUID(body["id"]),
        admin.id,
        token_hash(raw),
    )
    event = await db.scalar(select(AuditEvent).where(AuditEvent.action == "share_link.created"))
    # Pre-existing: the audit entry is written before the link has an id.
    assert (event.entity_id, event.summary) == (
        None,
        f"Utworzono link viewer dla „Piotr” ({TODAY} – {TODAY + timedelta(days=3)}, ważny 2 dni)",
    )

    listed = (await client.get("/api/v1/admin/share-links")).json()
    assert [item["id"] for item in listed] == [body["id"]]
    assert set(listed[0]) == {
        "id",
        "label",
        "starts_on",
        "ends_on",
        "expires_at",
        "created_at",
        "used_at",
        "revoked_at",
    }

    viewer = client.__class__(transport=client._transport, base_url="http://test")
    try:
        assert_error(
            await viewer.post("/api/v1/share/exchange", json={"token": "x" * 40}),
            404,
            "Link nie istnieje",
        )
        exchanged = await viewer.post("/api/v1/share/exchange", json={"token": raw})
        assert exchanged.status_code == 200, exchanged.text
        assert exchanged.json() == {
            "display_name": "Piotr",
            "role": "viewer",
            "starts_on": TODAY.isoformat(),
            "ends_on": (TODAY + timedelta(days=3)).isoformat(),
            "expires_at": exchanged.json()["expires_at"],
        }
        assert "oncall_session" in exchanged.headers["set-cookie"]
        assert_error(
            await viewer.post("/api/v1/share/exchange", json={"token": raw}),
            410,
            "Link został już użyty",
        )
    finally:
        await viewer.aclose()
    await db.refresh(link)
    assert link.used_at is not None
    sessions = await db.scalar(
        select(func.count()).select_from(Session).where(Session.share_link_id == link.id)
    )
    assert sessions == 1
    exchange = await db.scalar(
        select(AuditEvent).where(AuditEvent.action == "share_link.exchanged")
    )
    assert (exchange.actor_label, exchange.entity_id, exchange.summary) == (
        "link: Piotr",
        str(link.id),
        "Wymieniono jednorazowy link „Piotr” na sesję viewer",
    )

    assert_error(
        await client.delete(f"/api/v1/admin/share-links/{uuid.uuid4()}"),
        404,
        "Nie znaleziono linku",
    )
    assert (await client.delete(f"/api/v1/admin/share-links/{link.id}")).status_code == 204
    assert (await client.delete(f"/api/v1/admin/share-links/{link.id}")).status_code == 204
    revocations = (
        await db.scalars(select(AuditEvent).where(AuditEvent.action == "share_link.revoked"))
    ).all()
    assert [(item.entity_id, item.summary) for item in revocations] == [
        (str(link.id), "Odwołano link viewer dla „Piotr”")
    ]


async def test_an_expired_or_revoked_link_is_gone(client, db) -> None:
    admin = await create_user(db, "admin", role=UserRole.admin)
    for label, expires_at, revoked_at in (
        ("stary", datetime.now(UTC) - timedelta(minutes=1), None),
        ("odwolany", datetime.now(UTC) + timedelta(days=1), datetime.now(UTC)),
    ):
        db.add(
            ShareLink(
                token_hash=token_hash(label * 5),
                label=label,
                starts_on=TODAY,
                ends_on=TODAY,
                expires_at=expires_at,
                revoked_at=revoked_at,
                created_by_id=admin.id,
            )
        )
    await db.commit()
    for label in ("stary", "odwolany"):
        assert_error(
            await client.post("/api/v1/share/exchange", json={"token": label * 5}),
            410,
            "Link wygasł lub został odwołany",
        )


async def test_calendar_feeds(client, db) -> None:
    admin = await create_user(db, "admin", role=UserRole.admin)
    anna = await create_user(db, "anna", display_name="Anna Kowalska")
    await create_member(db, anna, display_name="Anna Kowalska")
    await create_user(db, "gosc", display_name="Gość")
    await create_published_schedule(
        db, starts_on=TODAY - timedelta(days=1), days=5, primary=["Anna Kowalska"]
    )

    await login(client, "gosc")
    assert_error(
        await client.post("/api/v1/calendar/feeds", json={"label": "x"}),
        403,
        "Konto nie jest powiązane z członkiem zespołu",
    )
    assert_error(
        await client.get("/api/v1/calendar/feeds"),
        403,
        "Konto nie jest powiązane z członkiem zespołu",
    )

    await login(client, "anna")
    created = await client.post("/api/v1/calendar/feeds", json={"label": "Telefon"})
    assert created.status_code == 201, created.text
    assert set(created.json()) == {"id", "url"}
    raw = created.json()["url"].rsplit("/calendar/feed/", 1)[1].removesuffix(".ics")
    event = await db.scalar(select(AuditEvent).where(AuditEvent.action == "feed.created"))
    assert (event.entity_id, event.summary) == (
        created.json()["id"],
        "Utworzono subskrypcję ICS „Telefon” (Anna Kowalska)",
    )
    feed = await client.get(f"/calendar/feed/{raw}.ics")
    assert feed.status_code == 200
    assert feed.headers["content-disposition"] == "inline; filename=oncall.ics"
    assert feed.headers["content-type"] == "text/calendar; charset=utf-8"
    assert feed.text.count("SUMMARY:PRIMARY · Anna Kowalska") == 5
    token = await db.scalar(select(CalendarFeedToken))
    await db.refresh(token)
    assert token.last_used_at is not None
    listed = (await client.get("/api/v1/calendar/feeds")).json()
    assert [item["id"] for item in listed] == [str(token.id)]

    await login(client, "gosc")
    assert_error(
        await client.delete(f"/api/v1/calendar/feeds/{token.id}"),
        404,
        "Nie znaleziono subskrypcji",
    )
    await login(client, "admin")
    assert (await client.delete(f"/api/v1/calendar/feeds/{token.id}")).status_code == 204
    assert (await client.delete(f"/api/v1/calendar/feeds/{token.id}")).status_code == 204
    revoked = (
        await db.scalars(select(AuditEvent).where(AuditEvent.action == "feed.revoked"))
    ).all()
    assert [item.actor_label for item in revoked] == [admin.display_name]
    assert_error(await client.get(f"/calendar/feed/{raw}.ics"), 404, "Subskrypcja nie istnieje")

    await db.execute(update(CalendarFeedToken).values(revoked_at=None, member_id=None))
    await db.commit()
    assert_error(await client.get(f"/calendar/feed/{raw}.ics"), 404, "Subskrypcja nie istnieje")

    assert_error(
        await client.post(f"/api/v1/admin/share-links/{uuid.uuid4()}/feed"),
        404,
        "Nie znaleziono linku",
    )
    link = ShareLink(
        token_hash="l" * 64,
        label="Piotr",
        starts_on=TODAY,
        ends_on=TODAY + timedelta(days=1),
        expires_at=datetime.now(UTC) + timedelta(days=1),
        created_by_id=admin.id,
    )
    db.add(link)
    await db.commit()
    link_feed = await client.post(f"/api/v1/admin/share-links/{link.id}/feed")
    assert link_feed.status_code == 201, link_feed.text
    link_raw = link_feed.json()["url"].rsplit("/calendar/feed/", 1)[1].removesuffix(".ics")
    stored = await db.scalar(
        select(CalendarFeedToken).where(CalendarFeedToken.id == uuid.UUID(link_feed.json()["id"]))
    )
    assert (stored.label, stored.kind.value, stored.share_link_id) == (
        "ICS: Piotr",
        "share_link",
        link.id,
    )
    shared = await client.get(f"/calendar/feed/{link_raw}.ics")
    assert shared.status_code == 200
    assert "X-WR-CALNAME:Erste On-call · Piotr" in shared.text
    await db.execute(update(ShareLink).values(revoked_at=datetime.now(UTC)))
    await db.commit()
    assert_error(
        await client.get(f"/calendar/feed/{link_raw}.ics"), 404, "Link wygasł lub został odwołany"
    )


async def test_account_links(client, db) -> None:
    fresh = await create_user(db, "nowa", display_name="Nowa Osoba")
    fresh.password_hash = None
    ldap = await create_user(db, "katalog")
    ldap.auth_source = AuthSource.ldap
    await db.commit()
    now = datetime.now(UTC)

    def issue(user, kind, raw, **values):
        db.add(
            AccountToken(
                user_id=user.id,
                kind=kind,
                token_hash=token_hash(raw),
                expires_at=values.get("expires_at", now + timedelta(hours=1)),
                used_at=values.get("used_at"),
            )
        )

    issue(fresh, AccountTokenKind.activation, "a" * 30)
    issue(fresh, AccountTokenKind.activation, "b" * 30, expires_at=now - timedelta(seconds=1))
    issue(fresh, AccountTokenKind.activation, "c" * 30, used_at=now)
    issue(ldap, AccountTokenKind.password_reset, "d" * 30)
    await db.commit()

    invalid = "Link jest nieprawidłowy lub wygasł"
    for raw, kind in (
        ("b" * 30, "activation"),
        ("c" * 30, "activation"),
        ("a" * 30, "password_reset"),
        ("z" * 30, "activation"),
    ):
        assert_error(
            await client.get("/api/v1/auth/password-token", params={"token": raw, "kind": kind}),
            400,
            invalid,
        )
        assert_error(
            await client.post(
                f"/api/v1/auth/{'activate' if kind == 'activation' else 'reset'}",
                json={"token": raw, "password": "Bardzo-Dobre-Haslo-7"},
            ),
            400,
            invalid,
        )
    info = await client.get(
        "/api/v1/auth/password-token", params={"token": "a" * 30, "kind": "activation"}
    )
    assert info.json() == {"username": "nowa", "display_name": "Nowa Osoba"}

    assert_error(
        await client.post(
            "/api/v1/auth/reset", json={"token": "d" * 30, "password": "Bardzo-Dobre-Haslo-7"}
        ),
        409,
        "Hasło konta LDAP jest zarządzane przez AD",
    )
    fresh.username = "haslo-login-12"
    await db.commit()
    assert_error(
        await client.post(
            "/api/v1/auth/activate", json={"token": "a" * 30, "password": "HASLO-LOGIN-12"}
        ),
        422,
        "Hasło nie może być takie jak login",
    )
    activated = await client.post(
        "/api/v1/auth/activate", json={"token": "a" * 30, "password": "Bardzo-Dobre-Haslo-7"}
    )
    assert activated.status_code == 204, activated.text
    assert (await _actions(db))[-1] == ("auth.activation", "Nowa Osoba")

    issue(fresh, AccountTokenKind.activation, "e" * 30)
    await db.commit()
    assert_error(
        await client.post(
            "/api/v1/auth/activate", json={"token": "e" * 30, "password": "Bardzo-Dobre-Haslo-8"}
        ),
        409,
        "Konto zostało już aktywowane",
    )


async def test_login_refusals_keep_their_records(client, db) -> None:
    retired = await create_user(db, "emeryt")
    retired.is_active = False
    await db.commit()

    assert_error(
        await client.post(
            "/api/v1/auth/login", json={"username": "emeryt", "password": TEST_PASSWORD}
        ),
        401,
        "Nieprawidłowy login lub hasło",
    )
    assert await _actions(db) == [
        ("auth.login_attempt", "emeryt"),
        ("auth.login_attempt", "ip:127.0.0.1"),
        ("auth.login_failed", "emeryt"),
    ]
    failed = await db.scalar(select(AuditEvent).where(AuditEvent.action == "auth.login_failed"))
    assert (failed.summary, failed.details) == (
        "Nieudana próba logowania: emeryt",
        {"count": 1, "last_ip": "127.0.0.1"},
    )

    app.dependency_overrides[get_directory_authenticator] = lambda: FakeDirectory(
        error=DirectoryUnavailableError("timeout")
    )
    assert_error(
        await client.post("/api/v1/auth/login", json={"username": "ktos", "password": "x" * 12}),
        503,
        "Logowanie katalogowe jest chwilowo niedostępne",
    )
    unavailable = await db.scalar(
        select(AuditEvent).where(AuditEvent.action == "auth.ldap_unavailable")
    )
    assert (unavailable.actor_label, unavailable.summary, unavailable.details) == (
        "ktos",
        "Logowanie LDAP niedostępne: ktos",
        {"reason": "timeout"},
    )
    app.dependency_overrides[get_directory_authenticator] = lambda: FakeDirectory(
        error=DirectoryIdentityError("brak numeru")
    )
    assert (
        await client.post("/api/v1/auth/login", json={"username": "ktos", "password": "x" * 12})
    ).status_code == 503

    owner = await create_user(db, "anna")
    owner.personnel_number = "1"
    await db.commit()
    app.dependency_overrides[get_directory_authenticator] = lambda: FakeDirectory(
        directory_identity(personnel_number="000042")
    )
    assert_error(
        await client.post("/api/v1/auth/login", json={"username": "anna", "password": "x" * 12}),
        409,
        "Login lub numer pracownika jest już przypisany do innego konta",
    )
    conflict = await db.scalar(
        select(AuditEvent).where(AuditEvent.action == "auth.ldap_identity_conflict")
    )
    assert (conflict.actor_label, conflict.summary) == (
        "anna",
        "Nie można powiązać konta LDAP: anna",
    )
    assert await db.scalar(select(func.count()).select_from(User)) == 2

    retired_ldap = await create_user(db, "stary.ldap")
    retired_ldap.auth_source = AuthSource.ldap
    retired_ldap.is_active = False
    retired_ldap.personnel_number = "000077"
    await db.commit()
    app.dependency_overrides[get_directory_authenticator] = lambda: FakeDirectory(
        directory_identity(username="stary.ldap", personnel_number="000077")
    )
    assert_error(
        await client.post(
            "/api/v1/auth/login", json={"username": "stary.ldap", "password": "x" * 12}
        ),
        401,
        "Nieprawidłowy login lub hasło",
    )


async def test_successful_logins_and_own_account(client, db) -> None:
    user = await create_user(db, "ola", display_name="Ola Nowak", email="ola@example.com")
    await create_member(db, user, display_name="Ola Nowak")
    response = await client.post(
        "/api/v1/auth/login", json={"username": " OLA ", "password": TEST_PASSWORD}
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "username": "ola",
        "display_name": "Ola Nowak",
        "role": "member",
        "has_team_member": True,
        "email": "ola@example.com",
        "phone": None,
        "share": None,
    }
    csrf = response.headers["x-csrf-token"]
    session = await db.scalar(select(Session))
    assert session.csrf_token == csrf
    assert (await _actions(db))[-1] == ("auth.login", "Ola Nowak")
    assert (await client.get("/api/v1/auth/csrf")).json() == {"csrf_token": csrf}

    client.headers["X-CSRF-Token"] = csrf
    phone = await client.patch("/api/v1/auth/me", json={"phone": "+48 600 100 200"})
    assert phone.status_code == 200, phone.text
    assert phone.json()["phone"] == (await client.get("/api/v1/auth/me")).json()["phone"]
    assert (await client.post("/api/v1/auth/logout")).status_code == 204
    assert await db.scalar(select(func.count()).select_from(Session)) == 0
    assert_error(await client.get("/api/v1/auth/me"), 401, "Brak aktywnej sesji")

    reset_user = await create_user(db, "reset")
    await login(client, "reset")
    db.add(
        AccountToken(
            user_id=reset_user.id,
            kind=AccountTokenKind.password_reset,
            token_hash=token_hash("r" * 30),
            expires_at=datetime.now(UTC) + timedelta(hours=1),
        )
    )
    await db.commit()
    changed = await client.post(
        "/api/v1/auth/reset", json={"token": "r" * 30, "password": "Bardzo-Dobre-Haslo-9"}
    )
    assert changed.status_code == 204
    assert (
        await db.scalar(
            select(func.count()).select_from(Session).where(Session.user_id == reset_user.id)
        )
    ) == 0
    assert (await _actions(db))[-1] == ("auth.password_reset", "Reset")
    await db.refresh(reset_user)
    assert reset_user.password_hash != hash_password(TEST_PASSWORD)
