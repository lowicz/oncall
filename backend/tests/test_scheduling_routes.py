"""Scheduling endpoints a coordinator drives by hand: comparing a daily and a
weekly variant, withdrawing a proposal, and the range a generation run takes."""

import uuid
from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.vocabulary import AssignmentRole, RotationMode, ScheduleStatus, UserRole
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment, Schedule
from oncall.infrastructure.sqlalchemy.scheduling_schedules import SqlAlchemySchedules
from tests.conftest import create_user, login

# A Saturday and Sunday, so each day has only the two on-call roles.
WEEKEND = date(2030, 3, 9)


async def _variant(
    db: AsyncSession,
    mode: RotationMode,
    primary: list[str],
    *,
    starts_on: date = WEEKEND,
    status: ScheduleStatus = ScheduleStatus.draft,
) -> Schedule:
    """A two-day draft; the secondary is always Zenon, so only primary varies."""
    schedule = Schedule(
        name=f"Wariant {mode.value}",
        starts_on=starts_on,
        ends_on=starts_on + timedelta(days=len(primary) - 1),
        status=status,
        rotation_mode=mode,
    )
    for offset, name in enumerate(primary):
        day = starts_on + timedelta(days=offset)
        schedule.assignments.append(
            Assignment(service_date=day, role=AssignmentRole.primary, assignee_name=name)
        )
        schedule.assignments.append(
            Assignment(service_date=day, role=AssignmentRole.secondary, assignee_name="Zenon")
        )
    db.add(schedule)
    await db.commit()
    return schedule


async def _coordinator(client: AsyncClient, db: AsyncSession) -> None:
    await create_user(db, "koord", role=UserRole.coordinator)
    await login(client, "koord")


async def test_a_daily_and_a_weekly_variant_are_set_side_by_side(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _coordinator(client, db)
    daily = await _variant(db, RotationMode.daily, ["Anna", "Bartek"])
    weekly = await _variant(db, RotationMode.weekly, ["Anna", "Anna"])

    response = await client.get(
        "/api/v1/scheduling/compare", params={"left_id": daily.id, "right_id": weekly.id}
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["starts_on"], body["ends_on"]) == ("2030-03-09", "2030-03-10")
    by_mode = {item["rotation_mode"]: item for item in body["variants"]}
    assert [item["id"] for item in body["variants"]] == [str(daily.id), str(weekly.id)]
    # Daily hands primary from Anna to Bartek; weekly keeps Anna on both days.
    assert by_mode["daily"] | {"id": None} == {
        "id": None,
        "name": "Wariant daily",
        "rotation_mode": "daily",
        "assignment_count": 4,
        "handovers": 1,
        "max_consecutive_days": 2,
        "load_spread": 0,
        "override_count": 0,
    }
    assert (by_mode["weekly"]["handovers"], by_mode["weekly"]["max_consecutive_days"]) == (0, 2)


async def test_comparing_a_missing_variant_is_not_found(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _coordinator(client, db)
    daily = await _variant(db, RotationMode.daily, ["Anna", "Bartek"])

    response = await client.get(
        "/api/v1/scheduling/compare", params={"left_id": daily.id, "right_id": uuid.uuid4()}
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Nie znaleziono jednego z wariantów"


async def test_variants_of_different_ranges_or_the_same_mode_do_not_compare(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _coordinator(client, db)
    daily = await _variant(db, RotationMode.daily, ["Anna", "Bartek"])
    other_daily = await _variant(db, RotationMode.daily, ["Bartek", "Anna"])
    later_weekly = await _variant(
        db, RotationMode.weekly, ["Anna", "Anna"], starts_on=WEEKEND + timedelta(days=7)
    )

    same_mode = await client.get(
        "/api/v1/scheduling/compare", params={"left_id": daily.id, "right_id": other_daily.id}
    )
    other_range = await client.get(
        "/api/v1/scheduling/compare", params={"left_id": daily.id, "right_id": later_weekly.id}
    )

    assert (same_mode.status_code, same_mode.json()["detail"]) == (
        422,
        "Wybierz jeden wariant dzienny i jeden tygodniowy",
    )
    assert (other_range.status_code, other_range.json()["detail"]) == (
        422,
        "Porównywane warianty muszą obejmować ten sam zakres dat",
    )


async def test_a_withdrawn_proposal_is_a_draft_again_and_the_move_is_recorded(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _coordinator(client, db)
    proposal = await _variant(
        db, RotationMode.daily, ["Anna", "Bartek"], status=ScheduleStatus.proposed
    )

    stale = await client.post(
        f"/api/v1/scheduling/{proposal.id}/withdraw", json={"expected_version": 7}
    )
    withdrawn = await client.post(
        f"/api/v1/scheduling/{proposal.id}/withdraw", json={"expected_version": 1}
    )

    assert stale.status_code == 409
    assert withdrawn.status_code == 200, withdrawn.text
    assert (withdrawn.json()["status"], withdrawn.json()["version"]) == ("draft", 2)
    events = (
        await db.scalars(select(AuditEvent).where(AuditEvent.action == "schedule.withdrawn"))
    ).all()
    assert [(item.entity_id, item.summary) for item in events] == [
        (str(proposal.id), f"Cofnięto propozycję {proposal.id} do szkicu")
    ]


async def test_a_generation_run_cannot_end_before_it_starts(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _coordinator(client, db)

    response = await client.post(
        "/api/v1/scheduling/runs", json={"starts_on": "2030-03-10", "ends_on": "2030-03-09"}
    )

    assert response.status_code == 422
    assert "Data końcowa nie może poprzedzać początkowej" in response.text


async def test_the_fairness_impact_of_a_missing_draft_is_not_found(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _coordinator(client, db)

    response = await client.get(f"/api/v1/scheduling/{uuid.uuid4()}/fairness-impact")

    assert response.status_code == 404
    assert response.json()["detail"] == "Nie znaleziono grafiku"


async def test_a_schedule_gone_before_it_is_read_back_is_not_found(
    client: AsyncClient, db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The withdrawal writes by status statement alone; the response is the
    schedule read back. If a concurrent delete wins in between, the answer is
    a 404 and the unit of work is rolled back, not a response about nothing."""
    await _coordinator(client, db)
    proposal = await _variant(
        db, RotationMode.daily, ["Anna", "Bartek"], status=ScheduleStatus.proposed
    )

    proposal_id = proposal.id

    async def vanished(self, schedule_id):
        return None

    monkeypatch.setattr(SqlAlchemySchedules, "schedule", vanished)

    response = await client.post(
        f"/api/v1/scheduling/{proposal_id}/withdraw", json={"expected_version": 1}
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Nie znaleziono grafiku"
    db.expire_all()
    stored = await db.get(Schedule, proposal_id)
    assert stored is not None
    assert (stored.status, stored.version) == (ScheduleStatus.proposed, 1)
