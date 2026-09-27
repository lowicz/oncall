"""The author of a swap request withdraws it before it is decided."""

import uuid
from datetime import date, timedelta

from sqlalchemy import select

from oncall.domain.vocabulary import SwapStatus, UserRole
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.swap_models import SwapRequest
from oncall.workdays import is_working_day, polish_holidays
from tests.conftest import create_member, create_published_schedule, create_user, login


def _future_weekday() -> date:
    day = date.today() + timedelta(days=10)
    holidays = polish_holidays(day, day + timedelta(days=30))
    while not is_working_day(day, holidays):
        day += timedelta(days=1)
    return day


async def test_the_author_withdraws_a_pending_request_with_a_reason(client, db) -> None:
    day = _future_weekday()
    members = {}
    for username, name in (("anna", "Anna"), ("bartek", "Bartek"), ("dawid", "Dawid")):
        user = await create_user(db, username, display_name=name)
        members[username] = await create_member(db, user, display_name=name)
    await create_user(db, "koord", role=UserRole.coordinator)
    schedule = await create_published_schedule(
        db, starts_on=day, days=1, primary=["Anna"], secondary=["Bartek"]
    )
    await login(client, "anna")
    created = await client.post(
        "/api/v1/swaps",
        json={
            "schedule_id": str(schedule.id),
            "service_date": day.isoformat(),
            "role": "primary",
            "replacement_member_id": str(members["dawid"].id),
        },
    )
    assert created.status_code == 201, created.text
    swap_id = created.json()["id"]

    response = await client.post(
        f"/api/v1/swaps/{swap_id}/cancel", json={"reason": "zmiana planów"}
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["id"], body["status"], body["decision_note"]) == (
        swap_id,
        SwapStatus.cancelled,
        "zmiana planów",
    )
    status = await db.scalar(select(SwapRequest.status).where(SwapRequest.id == uuid.UUID(swap_id)))
    assert status == SwapStatus.cancelled
    audited = await db.scalar(select(AuditEvent).where(AuditEvent.action == "swap.cancelled"))
    assert audited is not None
    assert audited.entity_id == swap_id
    # A withdrawn request can no longer be accepted by the person it asked.
    await login(client, "dawid")
    assert (await client.post(f"/api/v1/swaps/{swap_id}/accept")).status_code == 409
