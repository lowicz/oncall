"""Twarda niedostępność jako ograniczenie twarde cyklu szkicu.

Solver sam nie przypisze osoby z wpisem „nie mogę", ale szkic mógł powstać na
dniu, na który ktoś niedostępność wpisał PÓŹNIEJ. Publikacja takiego szkicu
ustawiłaby osobę niedostępną na żywym dyżurze, czego model nigdy by nie
wygenerował (BLK użytkownika z QA-REPORT-4, BD-01).
"""

from datetime import date

from oncall.domain.vocabulary import (
    AssignmentRole,
    AvailabilityKind,
    RotationMode,
    ScheduleStatus,
    UserRole,
)
from oncall.infrastructure.sqlalchemy.availability_model import Availability
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment, Schedule
from oncall.infrastructure.sqlalchemy.team_models import Eligibility, TeamMember
from tests.conftest import create_user, login

WEEKDAY = date(2026, 9, 7)


def _complete_draft(anna: TeamMember, marek: TeamMember) -> Schedule:
    schedule = Schedule(
        name="Szkic hybrydowy 07-09-2026 - 07-09-2026",
        starts_on=WEEKDAY,
        ends_on=WEEKDAY,
        status=ScheduleStatus.draft,
        version=1,
        rotation_mode=RotationMode.hybrid,
        assignments=[
            Assignment(
                service_date=WEEKDAY,
                role=AssignmentRole.primary,
                assignee_name=anna.display_name,
                member_id=anna.id,
            ),
            Assignment(
                service_date=WEEKDAY,
                role=AssignmentRole.secondary,
                assignee_name=marek.display_name,
                member_id=marek.id,
            ),
            Assignment(
                service_date=WEEKDAY,
                role=AssignmentRole.late_shift,
                assignee_name=marek.display_name,
                member_id=marek.id,
            ),
        ],
    )
    return schedule


async def _seed_team(db) -> tuple[TeamMember, TeamMember]:
    await create_user(db, "koord.bd", role=UserRole.coordinator, display_name="Koordynator BD")
    anna_user = await create_user(db, "anna.bd", display_name="Anna BD")
    marek_user = await create_user(db, "marek.bd", display_name="Marek BD")
    anna = TeamMember(
        user_id=anna_user.id,
        display_name="Anna BD",
        active_from=date(2025, 1, 1),
    )
    anna.eligibility = [
        Eligibility(role=role, starts_on=anna.active_from) for role in AssignmentRole
    ]
    marek = TeamMember(
        user_id=marek_user.id,
        display_name="Marek BD",
        active_from=date(2025, 1, 1),
    )
    marek.eligibility = [
        Eligibility(role=role, starts_on=marek.active_from) for role in AssignmentRole
    ]
    db.add_all((anna, marek))
    await db.commit()
    await db.refresh(anna)
    await db.refresh(marek)
    return anna, marek


async def test_propose_rejects_draft_with_unavailable_member(client, db) -> None:
    anna, marek = await _seed_team(db)
    db.add(
        Availability(
            member_id=anna.id,
            kind=AvailabilityKind.unavailable,
            starts_on=WEEKDAY,
            ends_on=WEEKDAY,
        )
    )
    draft = _complete_draft(anna, marek)
    db.add(draft)
    await db.commit()
    await db.refresh(draft)

    await login(client, "koord.bd")
    response = await client.post(
        f"/api/v1/scheduling/{draft.id}/propose", json={"expected_version": 1}
    )
    assert response.status_code == 409, response.text
    detail = response.json()["detail"]
    assert detail["reason"] == "UNAVAILABLE", response.text
    assert any("ma twardą niedostępność" in item for item in detail["conflicts"]), detail


async def test_publish_rejects_draft_with_unavailable_member(client, db) -> None:
    anna, marek = await _seed_team(db)
    db.add(
        Availability(
            member_id=anna.id,
            kind=AvailabilityKind.unavailable,
            starts_on=WEEKDAY,
            ends_on=WEEKDAY,
        )
    )
    draft = _complete_draft(anna, marek)
    draft.status = ScheduleStatus.proposed
    db.add(draft)
    await db.commit()
    await db.refresh(draft)

    await login(client, "koord.bd")
    response = await client.post(
        f"/api/v1/scheduling/{draft.id}/publish", json={"expected_version": 1}
    )
    assert response.status_code == 409, response.text
    detail = response.json()["detail"]
    assert detail["reason"] == "UNAVAILABLE", response.text
    assert any("ma twardą niedostępność" in item for item in detail["conflicts"]), detail


async def test_propose_allows_draft_after_availability_cleared(client, db) -> None:
    anna, marek = await _seed_team(db)
    blocked = Availability(
        member_id=anna.id,
        kind=AvailabilityKind.unavailable,
        starts_on=WEEKDAY,
        ends_on=WEEKDAY,
    )
    db.add(blocked)
    draft = _complete_draft(anna, marek)
    db.add(draft)
    await db.commit()
    await db.refresh(draft)

    await db.delete(blocked)
    await db.commit()

    await login(client, "koord.bd")
    response = await client.post(
        f"/api/v1/scheduling/{draft.id}/propose", json={"expected_version": 1}
    )
    await db.rollback()
    # Availability no longer blocks; draft is complete, propose succeeds.
    assert response.status_code == 200, response.text
