from datetime import timedelta

from fastapi import Response

from oncall.auth import hash_password, set_session_cookie, share_link_active, verify_password
from oncall.config import get_settings
from oncall.infrastructure.sqlalchemy.sharing_models import ShareLink
from tests.conftest import create_user, login


def test_password_hash_round_trip() -> None:
    password_hash = hash_password("correct horse battery staple")
    assert verify_password(password_hash, "correct horse battery staple")
    assert not verify_password(password_hash, "wrong password")


def test_session_cookie_max_age_is_measured_from_the_clock(frozen_clock) -> None:
    response = Response()
    set_session_cookie(response, "raw-token", frozen_clock.instant + timedelta(hours=12))

    cookie = response.headers["set-cookie"]
    assert cookie.startswith(f"{get_settings().session_cookie_name}=raw-token;")
    assert "Max-Age=43200" in cookie


def test_an_expiry_already_behind_the_clock_yields_a_zero_max_age(frozen_clock) -> None:
    response = Response()
    set_session_cookie(response, "raw-token", frozen_clock.instant - timedelta(seconds=1))
    assert "Max-Age=0" in response.headers["set-cookie"]


def test_share_link_activity_falls_back_to_the_clock(frozen_clock) -> None:
    link = ShareLink(expires_at=frozen_clock.instant + timedelta(seconds=1), revoked_at=None)

    assert share_link_active(link)
    frozen_clock.advance(timedelta(seconds=2))
    assert not share_link_active(link)
    # An explicit moment still wins over the clock.
    assert share_link_active(link, now=frozen_clock.instant - timedelta(seconds=2))


async def test_a_session_expires_by_the_clock(client, db, frozen_clock) -> None:
    await create_user(db, "anna")
    await login(client, "anna")
    assert (await client.get("/api/v1/auth/me")).status_code == 200

    frozen_clock.advance(timedelta(hours=get_settings().session_ttl_hours))

    expired = await client.get("/api/v1/auth/me")
    assert expired.status_code == 401
    assert expired.json()["detail"] == "Sesja wygasła"
