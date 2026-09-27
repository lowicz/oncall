"""What a request body is refused for before any use case sees it, and the
sentence the refusal carries: each validator's own words, in the language of
the request, without Pydantic's "Value error, " prefix."""

import pytest
from httpx import AsyncClient

from oncall.domain.vocabulary import CalendarEventColor, UserRole
from oncall.i18n import translate
from tests.conftest import create_member, create_user, login


def _refusal(response) -> tuple[list, str]:
    assert response.status_code == 422, response.text
    [error] = response.json()["detail"]
    return error["loc"], error["msg"]


@pytest.fixture
async def admin(client: AsyncClient, db) -> AsyncClient:
    await create_user(db, "admin.v", role=UserRole.admin)
    await login(client, "admin.v")
    return client


async def test_a_login_with_a_space_is_refused(admin) -> None:
    response = await admin.post(
        "/api/v1/admin/users",
        json={"username": " Jan Nowak ", "first_name": "Jan", "role": "member"},
    )

    assert _refusal(response) == (["body", "username"], translate("admin.username_has_spaces"))


async def test_a_new_account_s_login_is_trimmed_and_lowered_and_a_blank_phone_is_none(
    admin,
) -> None:
    response = await admin.post(
        "/api/v1/admin/users",
        json={"username": "  Jan.Nowak ", "first_name": "Jan", "phone": "", "role": "member"},
    )

    assert response.status_code == 201, response.text
    created = response.json()["user"]
    assert created["username"] == "jan.nowak"
    assert created["phone"] is None


async def test_a_membership_cannot_end_before_it_began(admin, db) -> None:
    member = await create_member(db, await create_user(db, "ola.v"), display_name="Ola V")

    response = await admin.patch(
        f"/api/v1/admin/team-members/{member.id}",
        json={"active_from": "2027-03-01", "active_until": "2027-02-28"},
    )

    assert _refusal(response) == (["body"], translate("admin.membership_end_before_entry"))


async def test_an_eligibility_cannot_end_before_it_starts(admin, db) -> None:
    member = await create_member(db, await create_user(db, "ola.v"), display_name="Ola V")

    response = await admin.post(
        f"/api/v1/admin/team-members/{member.id}/eligibility",
        json={"role": "primary", "starts_on": "2027-03-01", "ends_on": "2027-02-01"},
    )

    assert _refusal(response) == (["body"], translate("admin.eligibility_ends_before_start"))


async def test_a_calendar_event_cannot_end_before_it_starts(admin) -> None:
    response = await admin.post(
        "/api/v1/calendar/events",
        json={
            "starts_on": "2027-03-02",
            "ends_on": "2027-03-01",
            "title": "Szkolenie",
            "color": list(CalendarEventColor)[0].value,
        },
    )

    assert _refusal(response) == (["body"], translate("calendar.range_ends_before_start"))


@pytest.mark.parametrize(
    ("ends_on", "key"),
    [("2027-02-28", "sharing.range_reversed"), ("2028-03-02", "sharing.range_too_long")],
)
async def test_a_share_link_s_range_must_run_forwards_and_within_a_year(
    admin, ends_on, key
) -> None:
    response = await admin.post(
        "/api/v1/admin/share-links",
        json={"label": "Dla recepcji", "starts_on": "2027-03-01", "ends_on": ends_on},
    )

    assert _refusal(response) == (["body"], translate(key))


async def test_one_availability_entry_spans_at_most_a_year(client, db) -> None:
    await create_user(db, "anna.v")
    await login(client, "anna.v")

    response = await client.post(
        "/api/v1/availability/me",
        json={"kind": "unavailable", "starts_on": "2027-01-01", "ends_on": "2028-01-03"},
    )

    assert _refusal(response) == (["body"], translate("availability.range_too_long"))


async def test_the_refusal_is_in_the_language_the_request_asked_for(admin) -> None:
    response = await admin.post(
        "/api/v1/admin/share-links",
        json={"label": "Reception", "starts_on": "2027-03-01", "ends_on": "2027-02-01"},
        headers={"Accept-Language": "en"},
    )

    assert _refusal(response) == (["body"], translate("sharing.range_reversed", "en"))
    assert response.headers["content-language"] == "en"


async def test_clearing_one_s_own_phone_with_a_blank_stores_none(client, db) -> None:
    await create_user(db, "anna.v", phone="+48123456789")
    await login(client, "anna.v")

    response = await client.patch("/api/v1/auth/me", json={"phone": ""})

    assert response.status_code == 200, response.text
    assert response.json()["phone"] is None
    assert (await client.get("/api/v1/auth/me")).json()["phone"] is None
