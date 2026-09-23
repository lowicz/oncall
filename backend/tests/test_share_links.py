from datetime import date, timedelta

from oncall.domain.vocabulary import UserRole
from tests.conftest import (
    create_member,
    create_published_schedule,
    create_user,
    login,
)


async def _seed_schedule(db):
    anna = await create_user(db, "anna", email="anna@example.com", display_name="Anna Kowalska")
    await create_member(db, anna, display_name="Anna Kowalska")
    today = date.today()
    schedule = await create_published_schedule(
        db, starts_on=today - timedelta(days=7), days=30, primary=["Anna Kowalska"]
    )
    return anna, schedule, today


async def _create_link(client, **overrides) -> dict:
    payload = {
        "label": "Piotr z Service Desk",
        "starts_on": str(date.today()),
        "ends_on": str(date.today() + timedelta(days=13)),
        "expires_days": 7,
    }
    payload.update(overrides)
    response = await client.post("/api/v1/admin/share-links", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def _token_from_url(url: str) -> str:
    return url.rsplit("/share/", 1)[1]


async def test_admin_creates_one_time_link(client, db) -> None:
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    created = await _create_link(client)
    assert created["url"].endswith(f"/share/{_token_from_url(created['url'])}")
    links = (await client.get("/api/v1/admin/share-links")).json()
    assert len(links) == 1
    assert links[0]["label"] == "Piotr z Service Desk"
    assert links[0]["used_at"] is None
    assert links[0]["revoked_at"] is None


async def test_member_cannot_create_link(client, db) -> None:
    await create_user(db, "anna")
    await login(client, "anna")
    response = await client.post(
        "/api/v1/admin/share-links",
        json={
            "label": "x",
            "starts_on": str(date.today()),
            "ends_on": str(date.today()),
            "expires_days": 7,
        },
    )
    assert response.status_code == 403


async def test_expiry_is_capped_at_30_days(client, db) -> None:
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    response = await client.post(
        "/api/v1/admin/share-links",
        json={
            "label": "x",
            "starts_on": str(date.today()),
            "ends_on": str(date.today() + timedelta(days=10)),
            "expires_days": 31,
        },
    )
    assert response.status_code == 422


async def test_exchange_starts_limited_viewer_session(client, db) -> None:
    _, schedule, today = await _seed_schedule(db)
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    created = await _create_link(
        client, starts_on=str(today - timedelta(days=2)), ends_on=str(today + timedelta(days=5))
    )
    token = _token_from_url(created["url"])

    guest = client.__class__(transport=client._transport, base_url="http://test")
    exchange = await guest.post("/api/v1/share/exchange", json={"token": token})
    assert exchange.status_code == 200, exchange.text
    assert exchange.json()["role"] == "viewer"
    assert exchange.json()["display_name"] == "Piotr z Service Desk"

    me = (await guest.get("/api/v1/auth/me")).json()
    assert me["role"] == "viewer"
    assert me["display_name"] == "Piotr z Service Desk"
    assert me["share"]["starts_on"] == str(today - timedelta(days=2))

    published = (await guest.get("/api/v1/schedules/published")).json()
    dates = {item["service_date"] for item in published["assignments"]}
    assert dates
    assert min(dates) >= str(today - timedelta(days=2))
    assert max(dates) <= str(today + timedelta(days=5))

    second = await guest.post("/api/v1/share/exchange", json={"token": token})
    assert second.status_code == 410


async def test_share_session_gets_the_on_call_phone_but_not_the_email(client, db) -> None:
    anna, _, today = await _seed_schedule(db)
    anna.phone = "600100200"
    await db.commit()
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    created = await _create_link(
        client, starts_on=str(today - timedelta(days=2)), ends_on=str(today + timedelta(days=5))
    )
    token = _token_from_url(created["url"])

    guest = client.__class__(transport=client._transport, base_url="http://test")
    await guest.post("/api/v1/share/exchange", json={"token": token})

    published = (await guest.get("/api/v1/schedules/published")).json()
    primary = next(item for item in published["current"] if item["role"] == "primary")
    assert primary["assignee_name"] == "Anna Kowalska"
    assert primary["contact_phone"] == "600100200"
    assert primary["contact_email"] is None


async def test_share_session_hides_current_duty_outside_its_own_range(client, db) -> None:
    """QA7-L05: a link scoped to 14-20.09 must not leak who is on call today."""
    _, schedule, today = await _seed_schedule(db)
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    created = await _create_link(
        client, starts_on=str(today + timedelta(days=2)), ends_on=str(today + timedelta(days=8))
    )
    token = _token_from_url(created["url"])

    guest = client.__class__(transport=client._transport, base_url="http://test")
    await guest.post("/api/v1/share/exchange", json={"token": token})

    published = (await guest.get("/api/v1/schedules/published")).json()
    assert published["current"] == []


async def test_exchange_rejects_unknown_token(client) -> None:
    response = await client.post("/api/v1/share/exchange", json={"token": "a" * 43})
    assert response.status_code == 404


async def test_share_session_cannot_write(client, db) -> None:
    await _seed_schedule(db)
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    created = await _create_link(client)
    guest = client.__class__(transport=client._transport, base_url="http://test")
    await guest.post("/api/v1/share/exchange", json={"token": _token_from_url(created["url"])})
    response = await guest.post(
        "/api/v1/availability/me",
        json={
            "kind": "unavailable",
            "starts_on": str(date.today()),
            "ends_on": str(date.today()),
        },
    )
    assert response.status_code == 403


async def test_share_session_calendar_is_clipped_to_link_range(client, db) -> None:
    _, _, today = await _seed_schedule(db)
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    created = await _create_link(
        client, starts_on=str(today), ends_on=str(today + timedelta(days=3))
    )
    guest = client.__class__(transport=client._transport, base_url="http://test")
    await guest.post("/api/v1/share/exchange", json={"token": _token_from_url(created["url"])})
    ok = await guest.get(
        "/api/v1/calendar",
        params={
            "starts_on": str(today - timedelta(days=10)),
            "ends_on": str(today + timedelta(days=30)),
        },
    )
    assert ok.status_code == 200
    days = ok.json()["days"]
    assert days[0]["service_date"] == str(today)
    assert days[-1]["service_date"] == str(today + timedelta(days=3))
    outside = await guest.get(
        "/api/v1/calendar",
        params={
            "starts_on": str(today + timedelta(days=10)),
            "ends_on": str(today + timedelta(days=20)),
        },
    )
    assert outside.status_code == 422


async def test_revoked_link_cannot_be_exchanged(client, db) -> None:
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    created = await _create_link(client)
    links = (await client.get("/api/v1/admin/share-links")).json()
    revoke = await client.delete(f"/api/v1/admin/share-links/{links[0]['id']}")
    assert revoke.status_code == 204
    response = await client.post(
        "/api/v1/share/exchange", json={"token": _token_from_url(created["url"])}
    )
    assert response.status_code == 410


async def test_revoking_link_kills_existing_session(client, db) -> None:
    await _seed_schedule(db)
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")
    created = await _create_link(client)
    guest = client.__class__(transport=client._transport, base_url="http://test")
    await guest.post("/api/v1/share/exchange", json={"token": _token_from_url(created["url"])})
    assert (await guest.get("/api/v1/auth/me")).status_code == 200
    links = (await client.get("/api/v1/admin/share-links")).json()
    await client.delete(f"/api/v1/admin/share-links/{links[0]['id']}")
    assert (await guest.get("/api/v1/auth/me")).status_code == 401
