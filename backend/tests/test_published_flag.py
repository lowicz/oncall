"""Zaimportowana historia to nie publikacja (MED5-01).

`screens/Duty.tsx` uznawał niepuste `id` z `/schedules/published` za dowód
publikacji, a odpowiedź wypełniała je również z zaimportowanej historii, która
leży w bazie jako grafik `superseded`.
"""

from datetime import date, timedelta

from oncall.models import (
    Assignment,
    AssignmentRole,
    RotationMode,
    Schedule,
    ScheduleStatus,
)
from tests.conftest import create_member, create_user, login

TODAY = date.today()


async def _member(db, username: str, name: str):
    user = await create_user(db, username, display_name=name)
    return await create_member(db, user, display_name=name)


def _schedule(status: ScheduleStatus, name: str, anna, marek) -> Schedule:
    return Schedule(
        name=name,
        starts_on=TODAY,
        ends_on=TODAY,
        status=status,
        version=1,
        rotation_mode=RotationMode.hybrid,
        assignments=[
            Assignment(
                service_date=TODAY,
                role=AssignmentRole.primary,
                assignee_name=anna.display_name,
                member_id=anna.id,
            ),
            Assignment(
                service_date=TODAY,
                role=AssignmentRole.secondary,
                assignee_name=marek.display_name,
                member_id=marek.id,
            ),
        ],
    )


async def test_imported_history_alone_does_not_count_as_published(client, db) -> None:
    anna = await _member(db, "anna.pub", "Anna Pub")
    marek = await _member(db, "marek.pub", "Marek Pub")
    db.add(
        _schedule(
            ScheduleStatus.superseded,
            f"Import historii: history.csv {TODAY + timedelta(days=1)}",
            anna,
            marek,
        )
    )
    await db.commit()

    await login(client, "anna.pub")
    body = (await client.get("/api/v1/schedules/published")).json()
    # The identity is still reported - a swap needs something to target - but
    # the screen must not call it a publication.
    assert body["id"] is not None, body
    assert body["is_published"] is False, body


async def test_a_real_publication_is_reported_as_published(client, db) -> None:
    anna = await _member(db, "anna.pub", "Anna Pub")
    marek = await _member(db, "marek.pub", "Marek Pub")
    db.add(_schedule(ScheduleStatus.published, "Grafik hybrydowy", anna, marek))
    await db.commit()

    await login(client, "anna.pub")
    body = (await client.get("/api/v1/schedules/published")).json()
    assert body["is_published"] is True, body


async def test_nothing_covered_reports_no_publication(client, db) -> None:
    await _member(db, "anna.pub", "Anna Pub")
    await login(client, "anna.pub")
    body = (await client.get("/api/v1/schedules/published")).json()
    assert body["id"] is None and body["is_published"] is False, body
