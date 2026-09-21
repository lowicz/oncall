"""The HTTP answer to each business-rule failure: status, body, and what is
left stored afterwards.

These pin the contract the endpoints had before the use cases moved into
`oncall.domain`; the translation now happens in `routes/domain_edge.py`.
"""

import uuid
from datetime import date, timedelta

import pytest
from sqlalchemy import select, update

from oncall.domain.vocabulary import AssignmentRole, ScheduleStatus, SwapStatus, UserRole
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment, Schedule
from oncall.infrastructure.sqlalchemy.swap_models import SwapRequest
from oncall.infrastructure.sqlalchemy.team_models import Eligibility, TeamMember
from oncall.workdays import is_working_day, polish_holidays
from tests.conftest import create_member, create_published_schedule, create_user, login


def _future_weekday() -> date:
    day = date.today() + timedelta(days=10)
    holidays = polish_holidays(day, day + timedelta(days=30))
    while not (is_working_day(day, holidays) and day.weekday() == 2):
        day += timedelta(days=1)
    return day


DAY = _future_weekday()


@pytest.fixture
async def team(db) -> dict:
    members = {}
    for username, name in (
        ("anna", "Anna"),
        ("bartek", "Bartek"),
        ("celina", "Celina"),
        ("dawid", "Dawid"),
        ("ewa", "Ewa"),
    ):
        user = await create_user(db, username, display_name=name)
        members[username] = await create_member(db, user, display_name=name)
    await create_user(db, "koord", role=UserRole.coordinator, display_name="Koordynator")
    schedule = await create_published_schedule(
        db,
        starts_on=DAY,
        days=7,
        primary=["Anna", "Bartek", "Celina"],
        secondary=["Bartek", "Celina", "Anna"],
    )
    return {"members": members, "schedule": schedule}


async def _ask(client, team, replacement: str, role: str = "primary"):
    return await client.post(
        "/api/v1/swaps",
        json={
            "schedule_id": str(team["schedule"].id),
            "service_date": DAY.isoformat(),
            "role": role,
            "replacement_member_id": str(team["members"][replacement].id),
        },
    )


async def _set_slot(db, team, role: AssignmentRole, **values) -> None:
    await db.execute(
        update(Assignment)
        .where(
            Assignment.schedule_id == team["schedule"].id,
            Assignment.service_date == DAY,
            Assignment.role == role,
        )
        .values(**values)
    )
    await db.commit()


async def _accepted_swap(client, team) -> str:
    await login(client, "anna")
    created = await _ask(client, team, "dawid")
    assert created.status_code == 201, created.text
    await login(client, "dawid")
    swap_id = created.json()["id"]
    accepted = await client.post(f"/api/v1/swaps/{swap_id}/accept")
    assert accepted.status_code == 200, accepted.text
    return swap_id


def assert_error(response, status_code: int, detail) -> None:
    assert (response.status_code, response.json()["detail"]) == (status_code, detail)


async def test_swap_request_failures(client, db, team) -> None:
    account_only = await create_user(db, "gosc", display_name="Gość")
    since = DAY - timedelta(days=400)
    no_account = TeamMember(display_name="Bez Konta", active_from=since, user_id=None)
    no_account.eligibility = [Eligibility(role=role, starts_on=since) for role in AssignmentRole]
    db.add(no_account)
    await db.commit()

    await login(client, account_only.username)
    assert_error(
        await _ask(client, team, "dawid"), 403, "Konto nie jest powiązane z członkiem zespołu"
    )

    await login(client, "celina")
    assert_error(await _ask(client, team, "dawid"), 409, "Ten slot nie należy do Ciebie")

    await login(client, "anna")
    assert_error(await _ask(client, team, "anna"), 422, "Nie można zamienić się ze sobą")
    assert_error(await _ask(client, team, "bartek"), 422, "Zastępca ma już drugi on-call tego dnia")
    team["members"]["bez_konta"] = no_account
    assert_error(await _ask(client, team, "bez_konta"), 422, "Zastępca nie ma konta")

    assert (await _ask(client, team, "dawid")).status_code == 201
    assert_error(await _ask(client, team, "ewa"), 409, "Dla tego slotu istnieje aktywna zamiana")


async def test_swap_decision_failures(client, db, team) -> None:
    swap_id = await _accepted_swap(client, team)

    await login(client, "dawid")
    assert_error(
        await client.post(f"/api/v1/swaps/{swap_id}/cancel", json={"reason": "zmiana planów"}),
        403,
        "Tylko autor może wycofać prośbę",
    )
    assert_error(
        await client.post(f"/api/v1/swaps/{swap_id}/reject", json={"reason": "jednak nie"}),
        403,
        "Tylko koordynator może odrzucić zaakceptowaną prośbę",
    )
    assert_error(
        await client.post(f"/api/v1/swaps/{uuid.uuid4()}/accept"), 404, "Nie znaleziono zamiany"
    )


async def test_approving_a_slot_that_changed_owner_keeps_the_cancellation(client, db, team) -> None:
    swap_id = await _accepted_swap(client, team)
    ewa = team["members"]["ewa"]
    await _set_slot(db, team, AssignmentRole.primary, assignee_name="Ewa", member_id=ewa.id)

    await login(client, "koord")
    assert_error(
        await client.post(f"/api/v1/swaps/{swap_id}/approve"),
        409,
        "Slot zmienił właściciela; prośba została automatycznie anulowana",
    )
    stored = (
        await db.execute(
            select(SwapRequest.status, SwapRequest.decision_note).where(
                SwapRequest.id == uuid.UUID(swap_id)
            )
        )
    ).one()
    assert tuple(stored) == (
        SwapStatus.cancelled,
        "Slot zmienił właściciela przed zatwierdzeniem",
    )


async def test_approving_against_a_retired_schedule_stores_nothing(client, db, team) -> None:
    swap_id = await _accepted_swap(client, team)
    await db.execute(
        update(Schedule)
        .where(Schedule.id == team["schedule"].id)
        .values(status=ScheduleStatus.superseded)
    )
    await db.commit()

    await login(client, "koord")
    assert_error(
        await client.post(f"/api/v1/swaps/{swap_id}/approve"),
        409,
        "Grafik zmienił się; utwórz nową zamianę",
    )
    holder = await db.scalar(
        select(Assignment.assignee_name).where(
            Assignment.schedule_id == team["schedule"].id,
            Assignment.service_date == DAY,
            Assignment.role == AssignmentRole.primary,
        )
    )
    status = await db.scalar(select(SwapRequest.status).where(SwapRequest.id == uuid.UUID(swap_id)))
    assert (holder, status) == ("Anna", SwapStatus.pending_coordinator)


async def test_impact_preview_failures(client, db, team) -> None:
    query = {
        "service_date": DAY.isoformat(),
        "role": "primary",
        "replacement_member_id": str(team["members"]["dawid"].id),
    }
    await login(client, "celina")
    assert_error(
        await client.get("/api/v1/swaps/impact", params=query),
        403,
        "Możesz sprawdzić tylko własne zamiany",
    )

    await _set_slot(db, team, AssignmentRole.primary, assignee_name="Zenon z importu")
    await login(client, "koord")
    assert_error(
        await client.get("/api/v1/swaps/impact", params=query),
        409,
        "Osoba z tego slotu nie jest członkiem zespołu",
    )


async def test_availability_failures(client, db, team) -> None:
    entry = {
        "kind": "prefer_not",
        "starts_on": DAY.isoformat(),
        "ends_on": (DAY + timedelta(days=2)).isoformat(),
    }
    await login(client, "anna")
    assert (await client.post("/api/v1/availability/me", json=entry)).status_code == 201
    assert_error(
        await client.post("/api/v1/availability/me", json=entry),
        409,
        "Taki wpis dostępności już istnieje",
    )
    assert_error(
        await client.post("/api/v1/availability/me", json={**entry, "kind": "unavailable"}),
        409,
        "Zakres nakłada się na istniejący wpis dostępności",
    )
    assert_error(
        await client.delete(f"/api/v1/availability/me/{uuid.uuid4()}"), 404, "Nie znaleziono wpisu"
    )

    await login(client, "koord")
    assert_error(
        await client.get(f"/api/v1/availability/members/{uuid.uuid4()}"),
        404,
        "Nie znaleziono członka zespołu",
    )


async def test_override_failures(client, db, team) -> None:
    schedule_id = str(team["schedule"].id)
    await login(client, "koord")

    def override(**changes):
        return client.post(
            "/api/v1/calendar/override",
            json={
                "schedule_id": schedule_id,
                "expected_version": 1,
                "service_date": DAY.isoformat(),
                "role": "primary",
                "replacement_member_id": str(team["members"]["dawid"].id),
                **changes,
            },
        )

    assert_error(await override(expected_version=9), 409, "Grafik zmienił się; odśwież kalendarz")
    assert_error(
        await override(replacement_member_id=str(team["members"]["anna"].id)),
        422,
        "Ta osoba już pełni tę rolę tego dnia",
    )
    # The second on-call check matches the identity only, never the label.
    bartek = team["members"]["bartek"]
    await _set_slot(db, team, AssignmentRole.secondary, member_id=bartek.id)
    assert_error(
        await override(replacement_member_id=str(bartek.id)),
        422,
        "Osoba ma już drugi on-call tego dnia",
    )
    saturday = DAY + timedelta(days=3)
    assert_error(
        await override(role="late_shift", service_date=saturday.isoformat()),
        422,
        "Zmiana 11–19 jest dostępna tylko w dni robocze",
    )

    line = {
        "service_date": DAY.isoformat(),
        "role": "primary",
        "replacement_member_id": str(team["members"]["dawid"].id),
    }

    def batch(*lines):
        return client.post(
            "/api/v1/calendar/override/batch",
            json={
                "schedule_id": schedule_id,
                "expected_version": 1,
                "assignments": list(lines),
                "reason": "Odejście osoby z zespołu",
            },
        )

    assert_error(await batch(line, line), 422, "Lista zawiera powtórzony slot")
    assert_error(
        await batch({**line, "service_date": (DAY + timedelta(days=30)).isoformat()}),
        404,
        "Nie znaleziono slotu grafiku",
    )
    version = await db.scalar(select(Schedule.version).where(Schedule.id == team["schedule"].id))
    assert version == 1
