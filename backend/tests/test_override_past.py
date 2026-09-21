from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.vocabulary import UserRole
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from tests.conftest import create_member, create_published_schedule, create_user, login


@pytest.mark.anyio
async def test_historical_override_requires_and_audits_reason(
    client: AsyncClient, db: AsyncSession
) -> None:
    day = date.today() - timedelta(days=2)
    anna_user = await create_user(db, "anna", display_name="Anna Wróbel")
    anna = await create_member(db, anna_user, display_name="Anna Wróbel")
    ola_user = await create_user(db, "ola", display_name="Ola Nowak")
    ola = await create_member(db, ola_user, display_name="Ola Nowak")
    marek_user = await create_user(db, "marek", display_name="Marek Kowal")
    marek = await create_member(db, marek_user, display_name="Marek Kowal")
    await create_user(db, "koord", role=UserRole.coordinator)
    schedule = await create_published_schedule(
        db, starts_on=day, days=1, primary=[anna.display_name], secondary=[ola.display_name]
    )
    await login(client, "koord")
    payload = {
        "schedule_id": str(schedule.id),
        "expected_version": schedule.version,
        "service_date": day.isoformat(),
        "role": "primary",
        "replacement_member_id": str(marek.id),
    }

    rejected = await client.post("/api/v1/calendar/override", json=payload)
    assert rejected.status_code == 422

    accepted = await client.post(
        "/api/v1/calendar/override",
        json={**payload, "reason": "Korekta błędu w ewidencji"},
    )
    assert accepted.status_code == 200, accepted.text
    event = await db.scalar(select(AuditEvent).where(AuditEvent.action == "schedule.override"))
    assert event is not None
    assert event.details["historical"] is True
    assert event.details["reason"] == "Korekta błędu w ewidencji"
