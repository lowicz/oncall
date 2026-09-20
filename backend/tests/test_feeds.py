from datetime import timedelta

from oncall.domain.clock import business_today
from oncall.models import UserRole
from tests.conftest import (
    create_member,
    create_published_schedule,
    create_user,
    login,
)


async def _seed(db):
    today = business_today()
    anna = await create_user(db, "anna", email="a@x.com", display_name="Anna Kowalska")
    marek = await create_user(db, "marek", email="m@x.com", display_name="Marek Nowak")
    await create_member(db, anna, display_name="Anna Kowalska")
    await create_member(db, marek, display_name="Marek Nowak")
    schedule = await create_published_schedule(
        db,
        starts_on=today - timedelta(days=3),
        days=20,
        primary=["Anna Kowalska", "Marek Nowak"],
        secondary=["Marek Nowak", "Anna Kowalska"],
        late_shift=["Marek Nowak"],
    )
    return today, schedule


def _feed_token(url: str) -> str:
    return url.rsplit("/calendar/feed/", 1)[1].removesuffix(".ics")


async def test_member_feed_contains_only_own_duties(client, db) -> None:
    today, _ = await _seed(db)
    await login(client, "anna")
    created = await client.post("/api/v1/calendar/feeds", json={"label": "Mój telefon"})
    assert created.status_code == 201, created.text
    url = created.json()["url"]

    ics_response = await client.get(f"/calendar/feed/{_feed_token(url)}.ics")
    assert ics_response.status_code == 200
    assert ics_response.headers["content-type"].startswith("text/calendar")
    ics = ics_response.text
    assert "BEGIN:VCALENDAR" in ics
    assert "SUMMARY:PRIMARY · Anna Kowalska" in ics
    assert "X-WR-CALNAME:Erste On-call · Anna Kowalska" in ics
    assert "Marek Nowak" not in ics


async def test_feed_token_can_be_listed_and_revoked(client, db) -> None:
    await _seed(db)
    await login(client, "anna")
    created = (await client.post("/api/v1/calendar/feeds", json={"label": "x"})).json()
    listed = (await client.get("/api/v1/calendar/feeds")).json()
    assert len(listed) == 1
    assert listed[0]["id"] == created["id"]
    assert listed[0]["revoked_at"] is None

    revoke = await client.delete(f"/api/v1/calendar/feeds/{created['id']}")
    assert revoke.status_code == 204
    revoked = await client.get(f"/calendar/feed/{_feed_token(created['url'])}.ics")
    assert revoked.status_code == 404


async def test_unknown_feed_token_returns_404(client, db) -> None:
    response = await client.get(f"/calendar/feed/{'a' * 43}.ics")
    assert response.status_code == 404


async def test_account_without_member_is_turned_away_from_feeds(client, db) -> None:
    # One response for one cause across create and list (LOW6-01/LOW6-02).
    await create_user(db, "viewer", role=UserRole.viewer)
    await login(client, "viewer")
    created = await client.post("/api/v1/calendar/feeds", json={"label": "x"})
    assert created.status_code == 403
    assert created.json()["detail"] == "Konto nie jest powiązane z członkiem zespołu"
    listed = await client.get("/api/v1/calendar/feeds")
    assert listed.status_code == 403
    assert listed.json()["detail"] == "Konto nie jest powiązane z członkiem zespołu"


async def test_member_cannot_revoke_someone_elses_feed(client, db) -> None:
    await _seed(db)
    await login(client, "anna")
    created = (await client.post("/api/v1/calendar/feeds", json={"label": "x"})).json()
    guest = client.__class__(transport=client._transport, base_url="http://test")
    await login(guest, "marek")
    response = await guest.delete(f"/api/v1/calendar/feeds/{created['id']}")
    assert response.status_code == 404


async def test_share_link_feed_is_scoped_to_link_range(client, db) -> None:
    today, _ = await _seed(db)
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    await client.post(
        "/api/v1/admin/share-links",
        json={
            "label": "Zewnętrzny",
            "starts_on": str(today),
            "ends_on": str(today + timedelta(days=2)),
            "expires_days": 7,
        },
    )
    links = (await client.get("/api/v1/admin/share-links")).json()
    feed = await client.post(f"/api/v1/admin/share-links/{links[0]['id']}/feed")
    assert feed.status_code == 201, feed.text
    url = feed.json()["url"]

    ics = (await client.get(f"/calendar/feed/{_feed_token(url)}.ics")).text
    assert "SUMMARY:PRIMARY · Anna Kowalska" in ics or "SUMMARY:PRIMARY · Marek Nowak" in ics
    assert "X-WR-CALNAME:Erste On-call · Zewnętrzny" in ics
    day_after_range = (today + timedelta(days=3)).strftime("%Y%m%d")
    assert f"DTSTART;VALUE=DATE:{day_after_range}" not in ics
    assert f"DTSTART;VALUE=DATE:{today.strftime('%Y%m%d')}" in ics
