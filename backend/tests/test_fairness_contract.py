"""Who may read fairness points, pinned before the rules moved into
`oncall.domain.balance`."""

import uuid
from datetime import date, timedelta

from tests.conftest import create_member, create_published_schedule, create_user, login


async def _team(db):
    for username, name in (("anna", "Anna"), ("bartek", "Bartek")):
        user = await create_user(db, username, display_name=name)
        await create_member(db, user, display_name=name)
    await create_user(db, "widz", role="viewer")
    await create_user(db, "gosc", display_name="Gość")
    await create_user(db, "koord", role="coordinator")
    await create_published_schedule(
        db, starts_on=date.today() - timedelta(days=10), days=8, primary=["Anna", "Bartek"]
    )


def assert_error(response, status_code, detail) -> None:
    assert (response.status_code, response.json()["detail"]) == (status_code, detail)


async def test_fairness_visibility(client, db) -> None:
    await _team(db)
    await login(client, "koord")
    team = (await client.get("/api/v1/fairness")).json()
    anna_id = next(item["member_id"] for item in team["members"] if item["display_name"] == "Anna")
    bartek_id = next(
        item["member_id"] for item in team["members"] if item["display_name"] == "Bartek"
    )
    assert len(team["spreads"]) == len(team["outliers"]) >= 1
    assert_error(
        await client.get("/api/v1/fairness/duties", params={"member_id": str(uuid.uuid4())}),
        404,
        "Nie znaleziono członka zespołu",
    )

    await login(client, "widz")
    for url, params in (
        ("/api/v1/fairness", {}),
        ("/api/v1/fairness/duties", {"member_id": anna_id}),
    ):
        assert_error(
            await client.get(url, params=params), 403, "Punkty są widoczne tylko dla zespołu"
        )

    await login(client, "gosc")
    for url, params in (
        ("/api/v1/fairness", {}),
        ("/api/v1/fairness/duties", {"member_id": anna_id}),
    ):
        assert_error(
            await client.get(url, params=params),
            403,
            "Konto nie jest powiązane z członkiem zespołu",
        )

    await login(client, "anna")
    own = (await client.get("/api/v1/fairness")).json()
    assert [item["display_name"] for item in own["members"]] == ["Anna"]
    assert (own["spreads"], own["outliers"], own["criterion_met"]) == ([], [], True)
    assert set(own["totals"]) == {
        "primary_points",
        "secondary_points",
        "late_shift_count",
        "weekend_duties",
        "holiday_duties",
    }
    duties = await client.get("/api/v1/fairness/duties", params={"member_id": anna_id})
    assert duties.status_code == 200 and duties.json()
    assert_error(
        await client.get("/api/v1/fairness/duties", params={"member_id": bartek_id}),
        403,
        "Możesz sprawdzić tylko własne dyżury",
    )
