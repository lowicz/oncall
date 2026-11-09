"""The roles of one day handed over in one correction (P7): SECONDARY and
11-19 taken by one person when 11-19 is somebody else's, saved as one
version with one audit entry and one round of e-mails, its balance projected
for everybody it moves a slot from or to, and undone by the inverse
correction inside the Undo window."""

from datetime import timedelta
from types import SimpleNamespace

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.clock import business_today
from oncall.domain.vocabulary import AssignmentRole, UserRole
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.notification_models import NotificationOutbox
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment
from oncall.notifications.templates import format_day
from tests.conftest import create_member, create_published_schedule, create_user, login

pytestmark = [pytest.mark.anyio, pytest.mark.usefixtures("frozen_clock")]

PEOPLE = (
    ("jan", "Jan Wiśniewski"),
    ("anna", "Anna Kowalska"),
    ("marek", "Marek Nowak"),
)


async def _day(db: AsyncSession):
    """Yesterday to Saturday: Jan PRIMARY and 11-19 (off the SECONDARY
    coupling), Anna SECONDARY, Marek free."""
    members = {}
    for username, name in PEOPLE:
        user = await create_user(db, username, display_name=name, email=f"{username}@example.com")
        members[username] = (await create_member(db, user, display_name=name)).id
    await create_user(db, "koord", role=UserRole.coordinator)
    schedule = await create_published_schedule(
        db,
        starts_on=business_today() - timedelta(days=1),
        days=6,
        primary=["Jan Wiśniewski"],
        secondary=["Anna Kowalska"],
        late_shift=["Jan Wiśniewski"],
    )
    # Read once: the tests expire the session to see each write.
    return SimpleNamespace(id=schedule.id, version=schedule.version), members


def _line(day, role: str, member_id) -> dict:
    return {
        "service_date": day.isoformat(),
        "role": role,
        "replacement_member_id": str(member_id),
    }


def _body(schedule, lines: list[dict], **extra) -> dict:
    return {
        "schedule_id": str(schedule.id),
        "expected_version": schedule.version,
        "kind": "multi_role",
        "assignments": lines,
        **extra,
    }


async def _holders(db: AsyncSession, schedule_id, day) -> dict[AssignmentRole, str]:
    db.expire_all()
    rows = await db.scalars(
        select(Assignment).where(
            Assignment.schedule_id == schedule_id, Assignment.service_date == day
        )
    )
    return {row.role: row.assignee_name for row in rows}


async def test_two_roles_for_one_person_are_one_correction_and_undo_takes_the_mails_back(
    client: AsyncClient, db: AsyncSession
) -> None:
    schedule, members = await _day(db)
    today = business_today()
    schedule_id, version = schedule.id, schedule.version
    await login(client, "koord")
    lines = [
        _line(today, "secondary", members["marek"]),
        _line(today, "late_shift", members["marek"]),
    ]

    saved = await client.post("/api/v1/calendar/override/batch", json=_body(schedule, lines))
    assert saved.status_code == 200, saved.text
    assert await _holders(db, schedule_id, today) == {
        AssignmentRole.primary: "Jan Wiśniewski",
        AssignmentRole.secondary: "Marek Nowak",
        AssignmentRole.late_shift: "Marek Nowak",
    }

    (audit,) = (
        await db.scalars(select(AuditEvent).where(AuditEvent.action == "schedule.override"))
    ).all()
    assert audit.summary == (
        f"Korekta {today} · SECONDARY: Anna Kowalska → Marek Nowak, "
        "11–19: Jan Wiśniewski → Marek Nowak"
    )
    assert audit.details["service_date"] == today.isoformat()
    assert audit.details["historical"] is False
    assert [move["previous_assignee_name"] for move in audit.details["moves"]] == [
        "Anna Kowalska",
        "Jan Wiśniewski",
    ]

    outbox = {row.recipient: row for row in await db.scalars(select(NotificationOutbox))}
    day = format_day(today)
    assert {recipient: row.subject for recipient, row in outbox.items()} == {
        "marek@example.com": f"Zmiana przydziału: {day} · SECONDARY i 11–19",
        "anna@example.com": f"Zmiana przydziału: {day} · SECONDARY",
        "jan@example.com": f"Zmiana przydziału: {day} · 11–19",
    }
    assert "Marek Nowak (poprzednio: Jan Wiśniewski)" in outbox["marek@example.com"].body

    # Undo hands each slot back to the person who had it, in one correction.
    undone = await client.post(
        "/api/v1/calendar/override/batch",
        json=_body(
            schedule,
            [
                _line(today, "secondary", members["anna"]),
                _line(today, "late_shift", members["jan"]),
            ],
            expected_version=version + 1,
            acknowledge_rule_violations=True,
        ),
    )
    assert undone.status_code == 200, undone.text
    assert await _holders(db, schedule_id, today) == {
        AssignmentRole.primary: "Jan Wiśniewski",
        AssignmentRole.secondary: "Anna Kowalska",
        AssignmentRole.late_shift: "Jan Wiśniewski",
    }
    # Back with the people it was published with, the day reads as published:
    # no correction mark and no displaced holder left behind.
    for row in await db.scalars(
        select(Assignment).where(
            Assignment.schedule_id == schedule_id, Assignment.service_date == today
        )
    ):
        assert (row.is_override, row.original_assignee_name, row.original_member_id) == (
            False,
            None,
            None,
        ), row.role
    rows = (await db.scalars(select(NotificationOutbox))).all()
    assert rows
    assert all(row.cancelled_at is not None for row in rows)


async def test_the_impact_names_everybody_the_correction_moves_a_slot_from_or_to(
    client: AsyncClient, db: AsyncSession
) -> None:
    schedule, members = await _day(db)
    today = business_today()
    await login(client, "koord")

    impact = await client.post(
        "/api/v1/calendar/override/batch/impact",
        json={
            "schedule_id": str(schedule.id),
            "assignments": [
                _line(today, "secondary", members["marek"]),
                _line(today, "late_shift", members["marek"]),
            ],
        },
    )
    assert impact.status_code == 200, impact.text
    body = impact.json()
    assert body["service_date"] == today.isoformat()
    assert body["points"] == 1
    sides = {side["display_name"]: side for side in body["members"]}
    assert list(sides) == ["Marek Nowak", "Anna Kowalska", "Jan Wiśniewski"]

    def moved(name: str, lens: str) -> float:
        side = sides[name]
        return side["after"][lens]["actual"] - side["before"][lens]["actual"]

    assert moved("Marek Nowak", "secondary") == 1
    assert moved("Marek Nowak", "late_shift") == 1
    assert moved("Anna Kowalska", "secondary") == -1
    assert moved("Jan Wiśniewski", "late_shift") == -1


async def test_an_unstaffed_slot_is_filled_and_counted_for_the_taker_only(
    client: AsyncClient, db: AsyncSession
) -> None:
    schedule, members = await _day(db)
    today = business_today()
    (late,) = await db.scalars(
        select(Assignment).where(
            Assignment.schedule_id == schedule.id,
            Assignment.service_date == today,
            Assignment.role == AssignmentRole.late_shift,
        )
    )
    await db.delete(late)
    await db.commit()
    await login(client, "koord")
    lines = [_line(today, "late_shift", members["marek"])]

    impact = await client.post(
        "/api/v1/calendar/override/batch/impact",
        json={"schedule_id": str(schedule.id), "assignments": lines},
    )
    assert impact.status_code == 200, impact.text
    assert [side["display_name"] for side in impact.json()["members"]] == ["Marek Nowak"]

    # Anna keeps SECONDARY, so 11-19 leaves its coupling: a rule to acknowledge.
    saved = await client.post(
        "/api/v1/calendar/override/batch",
        json=_body(schedule, lines, acknowledge_rule_violations=True),
    )
    assert saved.status_code == 200, saved.text
    assert (await _holders(db, schedule.id, today))[AssignmentRole.late_shift] == "Marek Nowak"
    (audit,) = (
        await db.scalars(select(AuditEvent).where(AuditEvent.action == "schedule.override"))
    ).all()
    assert audit.summary == (
        f"Korekta {today} · 11–19: brak obsady → Marek Nowak"
        " · świadome naruszenie reguł: zmiana 11–19 i rola kotwicząca są u różnych osób"
    )


@pytest.mark.parametrize(
    ("language", "expected"),
    [
        ("pl", "PRIMARY i SECONDARY nie zmieniają się w jednej korekcie"),
        ("en", "PRIMARY and SECONDARY do not change in one correction"),
    ],
)
async def test_the_on_call_pair_never_changes_in_one_correction(
    client: AsyncClient, db: AsyncSession, language: str, expected: str
) -> None:
    schedule, members = await _day(db)
    today = business_today()
    await login(client, "koord")

    refused = await client.post(
        "/api/v1/calendar/override/batch",
        json=_body(
            schedule,
            [_line(today, "primary", members["marek"]), _line(today, "secondary", members["jan"])],
        ),
        headers={"Accept-Language": language},
    )
    assert refused.status_code == 422, refused.text
    assert expected in refused.json()["detail"]
    assert (await _holders(db, schedule.id, today))[AssignmentRole.primary] == "Jan Wiśniewski"


async def test_a_correction_of_roles_refuses_what_a_single_correction_refuses(
    client: AsyncClient, db: AsyncSession
) -> None:
    schedule, members = await _day(db)
    today = business_today()
    saturday = today + timedelta(days=4)
    await login(client, "koord")

    async def refusal(lines: list[dict]) -> str:
        response = await client.post("/api/v1/calendar/override/batch", json=_body(schedule, lines))
        assert response.status_code == 422, response.text
        return response.json()["detail"]

    two_days = [
        _line(today, "secondary", members["marek"]),
        _line(today + timedelta(days=1), "secondary", members["marek"]),
    ]
    assert await refusal(two_days) == "Zmiana ról obejmuje jeden dzień"
    # Jan keeps PRIMARY, so SECONDARY would make him both on-calls of the day.
    assert await refusal([_line(today, "secondary", members["jan"])]) == (
        "Osoba ma już drugi on-call tego dnia"
    )
    assert await refusal([_line(today, "late_shift", members["jan"])]) == (
        "Ta osoba już pełni tę rolę tego dnia"
    )
    assert await refusal([_line(saturday, "late_shift", members["marek"])]) == (
        "Zmiana 11–19 jest dostępna tylko w dni robocze"
    )
    corrections = await db.scalars(
        select(AuditEvent).where(AuditEvent.action.startswith("schedule."))
    )
    assert corrections.all() == []


async def test_a_correction_of_roles_of_a_past_day_asks_for_a_reason(
    client: AsyncClient, db: AsyncSession
) -> None:
    schedule, members = await _day(db)
    yesterday = business_today() - timedelta(days=1)
    await login(client, "koord")
    body = _body(schedule, [_line(yesterday, "secondary", members["marek"])])

    refused = await client.post("/api/v1/calendar/override/batch", json=body)
    assert refused.status_code == 422, refused.text
    assert "minimum 10" in refused.json()["detail"]

    saved = await client.post(
        "/api/v1/calendar/override/batch",
        json={**body, "reason": "Zmiana uzgodniona po fakcie", "acknowledge_rule_violations": True},
    )
    assert saved.status_code == 200, saved.text
    (audit,) = (
        await db.scalars(select(AuditEvent).where(AuditEvent.action == "schedule.override"))
    ).all()
    assert audit.details["historical"] is True
    assert audit.details["reason"] == "Zmiana uzgodniona po fakcie"
