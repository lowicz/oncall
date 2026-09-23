from datetime import timedelta

from oncall.domain.clock import business_today
from oncall.domain.vocabulary import UserRole
from tests.conftest import create_member, create_user, login

TODAY = business_today()


async def test_calendar_reports_no_team_when_nobody_is_enrolled(client, db) -> None:
    await create_user(db, "admin", role=UserRole.admin)
    await login(client, "admin")

    calendar = await client.get(
        "/api/v1/calendar",
        params={"starts_on": str(TODAY), "ends_on": str(TODAY + timedelta(days=27))},
    )
    assert calendar.status_code == 200, calendar.text
    body = calendar.json()
    assert body["members"] == []
    assert body["team_has_members"] is False


async def test_calendar_flags_a_team_whose_members_are_all_future_dated(client, db) -> None:
    admin = await create_user(db, "admin", role=UserRole.admin)
    await create_member(
        db, admin, display_name="Anna", active_from=TODAY + timedelta(days=60)
    )
    await login(client, "admin")

    calendar = await client.get(
        "/api/v1/calendar",
        params={"starts_on": str(TODAY), "ends_on": str(TODAY + timedelta(days=27))},
    )
    assert calendar.status_code == 200, calendar.text
    body = calendar.json()
    assert body["members"] == []
    assert body["team_has_members"] is True
