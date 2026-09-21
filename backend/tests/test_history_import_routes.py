"""HGH-05/HGH-06: import historii nie wygrywa z publikacją i nie gubi tożsamości.

Krycie: history.py + effective.py, data 2026-09-23 (środa, dzień roboczy).
"""

import uuid
from datetime import UTC, date, datetime

from sqlalchemy import delete, select

from oncall.domain.vocabulary import AssignmentRole, ScheduleStatus, UserRole
from oncall.effective import effective_assignments
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment, Schedule
from oncall.infrastructure.sqlalchemy.team_models import Eligibility
from tests.conftest import create_member, create_published_schedule, create_user, login

DAY = date(2026, 9, 23)


def _csv(rows: list[tuple[date, str, str]]) -> bytes:
    return (
        "service_date,role,assignee_name\n"
        + "".join(f"{d.isoformat()},{role},{name}\n" for d, role, name in rows)
    ).encode()


async def _seed_coordinator_and_member(db, name: str):
    await create_user(
        db,
        "koord.h",
        role=UserRole.coordinator,
        display_name="Koordynator H",
    )
    user = await create_user(db, f"h.{name.split()[0].lower()}", display_name=f"u {name}")
    return await create_member(db, user, display_name=name)


async def test_commit_matches_member_case_insensitively_and_uses_roster_name(client, db) -> None:
    member = await _seed_coordinator_and_member(db, "Rafał Kamiński")
    await login(client, "koord.h")

    preview = await client.post(
        "/api/v1/history/preview",
        files={"file": ("history.csv", _csv([(DAY, "primary", "rafał kamiński")]), "text/csv")},
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["valid"], body["errors"]

    commit = await client.post(
        "/api/v1/history/commit",
        json={"filename": "history.csv", "rows": body["rows"]},
    )
    assert commit.status_code == 201, commit.text

    assignment = await db.scalar(
        select(Assignment).where(
            Assignment.schedule_id == uuid.UUID(commit.json()["schedule_id"]),
            Assignment.role == AssignmentRole.primary,
        )
    )
    assert assignment is not None
    assert assignment.member_id == member.id
    assert assignment.assignee_name == "Rafał Kamiński"


async def test_legacy_import_never_wins_over_real_publication(client, db) -> None:
    existing = await create_published_schedule(
        db,
        starts_on=DAY,
        days=1,
        primary=["Piotr Lewandowski"],
        secondary=["Marek Kowalski"],
        late_shift=["Marek Kowalski"],
    )
    imported = Schedule(
        name="Import historii: legacy.csv",
        starts_on=DAY,
        ends_on=DAY,
        status=ScheduleStatus.superseded,
        published_at=datetime.now(UTC),
        assignments=[
            Assignment(
                service_date=DAY,
                role=AssignmentRole.primary,
                assignee_name="Rafał Kamiński",
                member_id=None,
                is_override=False,
            )
        ],
    )
    db.add(imported)
    await db.commit()
    # Legacy rows were stamped with the wall-clock time of the import, i.e.
    # after this publication - exactly the state that used to override it.
    assert imported.published_at is not None
    assert imported.published_at >= existing.published_at.replace(tzinfo=UTC)

    resolved = await effective_assignments(db, DAY, DAY)
    assert resolved[(DAY, AssignmentRole.primary)].assignee_name == "Piotr Lewandowski"
    assert resolved[(DAY, AssignmentRole.primary)].schedule_id == existing.id


async def test_import_fills_slot_not_covered_by_any_publication(client, db) -> None:
    member = await _seed_coordinator_and_member(db, "Rafał Kamiński")
    imported = Schedule(
        name="Import historii: legacy.csv",
        starts_on=DAY,
        ends_on=DAY,
        status=ScheduleStatus.superseded,
        published_at=datetime.now(UTC),
        assignments=[
            Assignment(
                service_date=DAY,
                role=AssignmentRole.primary,
                assignee_name="Rafał Kamiński",
                member_id=member.id,
                is_override=False,
            )
        ],
    )
    db.add(imported)
    await db.commit()

    resolved = await effective_assignments(db, DAY, DAY)
    assert resolved[(DAY, AssignmentRole.primary)].member_id == member.id


async def test_preview_reports_conflict_with_published_schedule(client, db) -> None:
    await create_published_schedule(
        db,
        starts_on=DAY,
        days=1,
        primary=["Piotr Lewandowski"],
        secondary=["Marek Kowalski"],
        late_shift=["Marek Kowalski"],
    )
    await _seed_coordinator_and_member(db, "Rafał Kamiński")
    await login(client, "koord.h")

    preview = await client.post(
        "/api/v1/history/preview",
        files={"file": ("history.csv", _csv([(DAY, "primary", "rafał kamiński")]), "text/csv")},
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["valid"] is False
    assert any("objęta grafikiem opublikowanym" in row["message"] for row in body["errors"]), body


async def test_import_rejects_a_role_the_person_has_no_eligibility_for(client, db) -> None:
    """LOW5-13: okres członkostwa był walidowany, a eligibility roli nie, więc
    wiersz `primary` dla osoby bez tej eligibility przechodził i liczył się
    potem w jej udziale."""
    member = await _seed_coordinator_and_member(db, "Rafał Kamiński")
    await db.execute(
        delete(Eligibility).where(
            Eligibility.member_id == member.id,
            Eligibility.role == AssignmentRole.primary,
        )
    )
    await db.commit()
    await login(client, "koord.h")

    preview = await client.post(
        "/api/v1/history/preview",
        files={"file": ("history.csv", _csv([(DAY, "primary", "Rafał Kamiński")]), "text/csv")},
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert not body["valid"], body
    assert body["errors"] == [
        {
            "row_number": 2,
            "field": "role",
            "message": "Osoba nie ma eligibility do roli PRIMARY w tym dniu",
        }
    ], body["errors"]


async def test_import_accepts_a_role_the_person_does_hold(client, db) -> None:
    await _seed_coordinator_and_member(db, "Rafał Kamiński")
    await login(client, "koord.h")
    preview = await client.post(
        "/api/v1/history/preview",
        files={"file": ("history.csv", _csv([(DAY, "secondary", "Rafał Kamiński")]), "text/csv")},
    )
    assert preview.json()["valid"], preview.json()["errors"]
