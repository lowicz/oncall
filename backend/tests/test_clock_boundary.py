"""23:30 UTC on the 15th is 01:30 on the 16th in Warsaw.

One clock hands out both the business day and the absolute instant, and this
is the half hour in which they part: a date read off UTC would be a day behind
the team, an instant stamped with Warsaw wall time would be two hours ahead of
the truth. Each assertion pins one side of that line at the same frozen moment,
through the API, so a regression on either side surfaces where a user would
meet it.
"""

from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select

from oncall.config import get_settings
from oncall.domain.clock import as_utc
from oncall.models import AuditEvent, Session
from tests.conftest import TEST_PASSWORD, create_member, create_published_schedule, create_user

BOUNDARY = datetime(2026, 9, 15, 23, 30, tzinfo=UTC)
WARSAW_TODAY = date(2026, 9, 16)


def _declaration(day: date) -> dict:
    return {"kind": "unavailable", "starts_on": str(day), "ends_on": str(day)}


def _feed_token(url: str) -> str:
    return url.rsplit("/calendar/feed/", 1)[1].removesuffix(".ics")


async def test_business_day_is_warsaw_while_instants_stay_utc(client, db, frozen_clock) -> None:
    frozen_clock.instant = BOUNDARY
    session_lifetime = timedelta(hours=get_settings().session_ttl_hours)
    anna = await create_user(db, "anna", display_name="Anna Kowalska")
    await create_member(db, anna, display_name="Anna Kowalska")
    await create_published_schedule(
        db, starts_on=WARSAW_TODAY - timedelta(days=1), days=7, primary=["Anna Kowalska"]
    )

    signed_in = await client.post(
        "/api/v1/auth/login", json={"username": "anna", "password": TEST_PASSWORD}
    )
    assert signed_in.status_code == 200, signed_in.text
    client.headers["X-CSRF-Token"] = signed_in.headers["x-csrf-token"]

    # The business day: in Warsaw the 15th is over, so an entry ending on it is
    # in the past, and the 16th is today.
    utc_today = await client.post("/api/v1/availability/me", json=_declaration(BOUNDARY.date()))
    assert utc_today.status_code == 422, utc_today.text
    assert utc_today.json()["detail"] == "Nie można dodać dostępności w całości w przeszłości"
    warsaw_today = await client.post("/api/v1/availability/me", json=_declaration(WARSAW_TODAY))
    assert warsaw_today.status_code == 201, warsaw_today.text

    # The instant: what the session, the cookie and the trail record is the
    # UTC moment, not the Warsaw wall time.
    session = await db.scalar(select(Session))
    assert as_utc(session.expires_at) == BOUNDARY + session_lifetime
    assert f"Max-Age={int(session_lifetime.total_seconds())}" in signed_in.headers["set-cookie"]
    login_event = await db.scalar(select(AuditEvent).where(AuditEvent.action == "auth.login"))
    assert as_utc(login_event.occurred_at) == BOUNDARY

    # The same instant serialized for a calendar reader keeps its UTC wall
    # time and its Z, while the all-day events themselves are business dates.
    feed = await client.post("/api/v1/calendar/feeds", json={"label": "Telefon"})
    assert feed.status_code == 201, feed.text
    ics = (await client.get(f"/calendar/feed/{_feed_token(feed.json()['url'])}.ics")).text
    content = ics.split("\r\n")
    assert "DTSTAMP:20260915T233000Z" in content
    assert "DTSTART;VALUE=DATE:20260916" in content
