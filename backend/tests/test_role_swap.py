"""Two people trade one day's PRIMARY and SECONDARY in one correction: the
rules are checked on the state after both moves, the write is one version,
one audit entry and one round of e-mails, and the inverse swap within the
Undo window takes the e-mails back."""

from datetime import timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.clock import business_today
from oncall.domain.vocabulary import AssignmentRole, UserRole
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.notification_models import NotificationOutbox
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment
from oncall.notifications.templates import format_date, format_day
from tests.conftest import create_member, create_published_schedule, create_user, login

pytestmark = [pytest.mark.anyio, pytest.mark.usefixtures("frozen_clock")]


async def _swap_day(db: AsyncSession):
    """Yesterday and today (both working days): Anna PRIMARY, Marek SECONDARY and 11-19."""
    members = {}
    for username, name in (("anna", "Anna Kowalska"), ("marek", "Marek Nowak")):
        user = await create_user(db, username, display_name=name, email=f"{username}@example.com")
        members[username] = await create_member(db, user, display_name=name)
    await create_user(db, "koord", role=UserRole.coordinator)
    schedule = await create_published_schedule(
        db,
        starts_on=business_today() - timedelta(days=1),
        days=2,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
    )
    return schedule, members


def _lines(day, members, primary: str, secondary: str, *, with_late_shift: bool = True):
    return [
        {
            "service_date": day.isoformat(),
            "role": "primary",
            "replacement_member_id": str(members[primary].id),
        },
        {
            "service_date": day.isoformat(),
            "role": "secondary",
            "replacement_member_id": str(members[secondary].id),
            "with_late_shift": with_late_shift,
        },
    ]


async def _holders(db: AsyncSession, schedule_id, day) -> dict[AssignmentRole, str]:
    db.expire_all()
    rows = await db.scalars(
        select(Assignment).where(
            Assignment.schedule_id == schedule_id, Assignment.service_date == day
        )
    )
    return {row.role: row.assignee_name for row in rows}


async def test_a_role_swap_is_checked_saved_and_told_as_one_decision(
    client: AsyncClient, db: AsyncSession
) -> None:
    schedule, members = await _swap_day(db)
    today = business_today()
    schedule_id, version = schedule.id, schedule.version
    await login(client, "koord")
    swap = _lines(today, members, "marek", "anna")
    inverse = _lines(today, members, "anna", "marek")

    checked = await client.post(
        "/api/v1/calendar/override/batch/check",
        json={"batches": [{"schedule_id": str(schedule_id), "assignments": swap}]},
    )
    assert checked.status_code == 200, checked.text
    assert checked.json() == []

    saved = await client.post(
        "/api/v1/calendar/override/batch",
        json={
            "schedule_id": str(schedule_id),
            "expected_version": version,
            "kind": "role_swap",
            "assignments": swap,
        },
    )
    assert saved.status_code == 200, saved.text
    assert [(item["role"], item["assignee_name"]) for item in saved.json()] == [
        ("primary", "Marek Nowak"),
        ("secondary", "Anna Kowalska"),
        ("late_shift", "Anna Kowalska"),
    ]
    assert await _holders(db, schedule_id, today) == {
        AssignmentRole.primary: "Marek Nowak",
        AssignmentRole.secondary: "Anna Kowalska",
        AssignmentRole.late_shift: "Anna Kowalska",
    }

    (audit,) = (
        await db.scalars(select(AuditEvent).where(AuditEvent.action == "schedule.role_swap"))
    ).all()
    assert audit.summary == (
        f"Zamieniono role dnia {format_date(today)}: "
        "Marek Nowak PRIMARY, Anna Kowalska SECONDARY i 11–19"
    )
    assert audit.details["reason"] is None
    assert audit.details["slots"] == [
        f"{today}:primary",
        f"{today}:secondary",
        f"{today}:late_shift",
    ]

    outbox = {row.recipient: row for row in await db.scalars(select(NotificationOutbox))}
    assert set(outbox) == {"anna@example.com", "marek@example.com"}
    subject = (
        f"Zamiana ról {format_day(today)}: Marek Nowak PRIMARY, Anna Kowalska SECONDARY i 11–19"
    )
    assert {row.subject for row in outbox.values()} == {subject}
    assert {row.context["event"] for row in outbox.values()} == {"roles_swapped"}

    # Undo is the inverse swap; inside the window it takes the e-mails back.
    undone = await client.post(
        "/api/v1/calendar/override/batch",
        json={
            "schedule_id": str(schedule_id),
            "expected_version": version + 1,
            "kind": "role_swap",
            "assignments": inverse,
        },
    )
    assert undone.status_code == 200, undone.text
    assert await _holders(db, schedule_id, today) == {
        AssignmentRole.primary: "Anna Kowalska",
        AssignmentRole.secondary: "Marek Nowak",
        AssignmentRole.late_shift: "Marek Nowak",
    }
    rows = (await db.scalars(select(NotificationOutbox))).all()
    assert rows and all(row.cancelled_at is not None for row in rows)


async def test_a_role_swap_of_a_past_day_asks_for_a_reason(
    client: AsyncClient, db: AsyncSession
) -> None:
    schedule, members = await _swap_day(db)
    yesterday = business_today() - timedelta(days=1)
    await login(client, "koord")
    body = {
        "schedule_id": str(schedule.id),
        "expected_version": schedule.version,
        "kind": "role_swap",
        "assignments": _lines(yesterday, members, "marek", "anna"),
    }

    refused = await client.post("/api/v1/calendar/override/batch", json=body)
    assert refused.status_code == 422, refused.text
    assert "minimum 10" in refused.json()["detail"]

    saved = await client.post(
        "/api/v1/calendar/override/batch",
        json={**body, "reason": "Zamiana uzgodniona po fakcie"},
    )
    assert saved.status_code == 200, saved.text


async def test_a_correction_still_needs_a_reason_and_11_19_its_coupling(
    client: AsyncClient, db: AsyncSession
) -> None:
    schedule, members = await _swap_day(db)
    today = business_today()
    await login(client, "koord")

    no_reason = await client.post(
        "/api/v1/calendar/override/batch",
        json={
            "schedule_id": str(schedule.id),
            "expected_version": schedule.version,
            "assignments": _lines(today, members, "marek", "anna"),
        },
    )
    assert no_reason.status_code == 422, no_reason.text
    assert "Korekta wsadowa wymaga powodu" in no_reason.json()["detail"]

    # 11-19 cannot go along with PRIMARY: the policy binds it to SECONDARY.
    uncoupled = _lines(today, members, "marek", "anna")
    uncoupled[0]["with_late_shift"] = True
    refused = await client.post(
        "/api/v1/calendar/override/batch/check",
        json={"batches": [{"schedule_id": str(schedule.id), "assignments": uncoupled}]},
    )
    assert refused.status_code == 422, refused.text
    assert "11–19" in refused.json()["detail"]
