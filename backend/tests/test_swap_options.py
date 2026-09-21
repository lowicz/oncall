"""Lista zastępców niesie to, czego potrzeba do porównania kandydatów (MED5-09).

Podgląd wpływu pojawiał się dopiero po wyborze, więc porównanie dwóch osób
wymagało wybrania każdej osobno. Saldo zostaje w `/swaps/impact`, które ekran i
tak pobiera dla każdej opcji; tutaj jadą tylko fakty, których to nie zawiera.
"""

from datetime import UTC, date, datetime, timedelta

from oncall.domain.vocabulary import AssignmentRole, AvailabilityKind, ScheduleStatus
from oncall.infrastructure.sqlalchemy.availability_model import Availability
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment, Schedule
from oncall.infrastructure.sqlalchemy.team_models import TeamMember
from tests.conftest import create_member, create_user, login

# A working day near today: the 11-19 shift exists only on working days, so a
# fixed +3 offset made the suite fail whenever it landed on a weekend.
DAY = date.today() + timedelta(days=3)
while DAY.weekday() >= 5:
    DAY += timedelta(days=1)


async def _team(db) -> dict[str, TeamMember]:
    members: dict[str, TeamMember] = {}
    for username, name in (
        ("anna.opt", "Anna Opt"),
        ("marek.opt", "Marek Opt"),
        ("ola.opt", "Ola Opt"),
        ("piotr.opt", "Piotr Opt"),
    ):
        user = await create_user(db, username, display_name=name)
        members[name] = await create_member(db, user, display_name=name)
    schedule = Schedule(
        name="Grafik testowy",
        starts_on=DAY,
        ends_on=DAY,
        status=ScheduleStatus.published,
        published_at=datetime.now(UTC),
        assignments=[
            Assignment(
                service_date=DAY,
                role=role,
                assignee_name=members[name].display_name,
                member_id=members[name].id,
            )
            for role, name in (
                (AssignmentRole.primary, "Anna Opt"),
                (AssignmentRole.secondary, "Marek Opt"),
                (AssignmentRole.late_shift, "Ola Opt"),
            )
        ],
    )
    db.add(schedule)
    await db.commit()
    return members


async def test_options_flag_a_candidate_who_already_has_a_duty_that_day(client, db) -> None:
    await _team(db)
    await login(client, "anna.opt")
    response = await client.get(
        "/api/v1/swaps/options", params={"service_date": DAY.isoformat(), "role": "primary"}
    )
    assert response.status_code == 200, response.text
    by_name = {item["display_name"]: item for item in response.json()}

    # Marek holds secondary that day, so he is excluded from a primary swap
    # altogether; Ola holds 11-19, which does not exclude her but does stack.
    assert "Marek Opt" not in by_name, by_name
    assert by_name["Ola Opt"]["on_duty_that_day"] is True, by_name
    assert by_name["Piotr Opt"]["on_duty_that_day"] is False, by_name


async def test_options_carry_the_soft_preference_but_never_a_hard_one(client, db) -> None:
    members = await _team(db)
    db.add_all(
        (
            Availability(
                member_id=members["Piotr Opt"].id,
                kind=AvailabilityKind.prefer,
                starts_on=DAY,
                ends_on=DAY,
            ),
            Availability(
                member_id=members["Ola Opt"].id,
                kind=AvailabilityKind.unavailable,
                starts_on=DAY,
                ends_on=DAY,
            ),
        )
    )
    await db.commit()

    await login(client, "anna.opt")
    body = (
        await client.get(
            "/api/v1/swaps/options",
            params={"service_date": DAY.isoformat(), "role": "primary"},
        )
    ).json()
    by_name = {item["display_name"]: item for item in body}

    assert by_name["Piotr Opt"]["availability"] == "prefer", by_name
    # A hard „nie mogę" removes the person from the list, so the field can
    # never carry that value.
    assert "Ola Opt" not in by_name, by_name
    assert all(item["availability"] != "unavailable" for item in body), body


async def test_options_report_no_preference_when_none_was_entered(client, db) -> None:
    await _team(db)
    await login(client, "anna.opt")
    body = (
        await client.get(
            "/api/v1/swaps/options",
            params={"service_date": DAY.isoformat(), "role": "primary"},
        )
    ).json()
    assert body, body
    assert all(item["availability"] is None for item in body), body
    # The balance deliberately does not travel here; it is in /swaps/impact.
    assert all("deviation" not in item for item in body), body
