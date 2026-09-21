"""Abandoned drafts must be removable; published history must not be."""

import uuid
from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.vocabulary import ScheduleStatus, UserRole
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment, Schedule
from tests.conftest import (
    create_member,
    create_published_schedule,
    create_user,
    generate_draft_directly,
    login,
)

START = date.today() + timedelta(days=1)


async def _team(db: AsyncSession) -> None:
    for username, name in (
        ("anna", "Anna Kowalska"),
        ("marek", "Marek Nowak"),
        ("ola", "Ola Wiśniewska"),
    ):
        user = await create_user(db, username, display_name=name)
        await create_member(db, user, display_name=name)
    await create_user(db, "koord", role=UserRole.coordinator)


async def _generate(db: AsyncSession) -> dict:
    return await generate_draft_directly(db, "koord", START, START + timedelta(days=6))


@pytest.mark.anyio
async def test_deleting_a_draft_removes_it_and_its_assignments(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _team(db)
    await login(client, "koord")
    draft = await _generate(db)

    response = await client.delete(f"/api/v1/scheduling/{draft['id']}")
    assert response.status_code == 204, response.text

    assert (await client.get(f"/api/v1/scheduling/{draft['id']}")).status_code == 404
    assert draft["id"] not in [
        item["id"] for item in (await client.get("/api/v1/scheduling/drafts")).json()
    ]
    orphans = await db.scalar(
        select(func.count())
        .select_from(Assignment)
        .where(Assignment.schedule_id == uuid.UUID(draft["id"]))
    )
    assert orphans == 0


@pytest.mark.anyio
async def test_deleting_a_proposal_is_allowed(client: AsyncClient, db: AsyncSession) -> None:
    await _team(db)
    await login(client, "koord")
    draft = await _generate(db)
    proposed = await client.post(
        f"/api/v1/scheduling/{draft['id']}/propose",
        json={"expected_version": draft["version"]},
    )
    assert proposed.status_code == 200, proposed.text
    assert (await client.delete(f"/api/v1/scheduling/{draft['id']}")).status_code == 204


@pytest.mark.anyio
async def test_a_published_schedule_cannot_be_deleted(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _team(db)
    published = await create_published_schedule(
        db,
        starts_on=START,
        days=3,
        primary=["Anna Kowalska"],
        secondary=["Marek Nowak"],
        late_shift=["Ola Wiśniewska"],
    )
    await login(client, "koord")
    response = await client.delete(f"/api/v1/scheduling/{published.id}")
    assert response.status_code == 409

    still_there = await db.scalar(select(Schedule.status).where(Schedule.id == published.id))
    assert still_there == ScheduleStatus.published


@pytest.mark.anyio
async def test_members_cannot_delete_drafts(client: AsyncClient, db: AsyncSession) -> None:
    await _team(db)
    await login(client, "koord")
    draft = await _generate(db)

    await login(client, "anna")
    assert (await client.delete(f"/api/v1/scheduling/{draft['id']}")).status_code == 403


@pytest.mark.anyio
async def test_deletion_is_audited(client: AsyncClient, db: AsyncSession) -> None:
    await _team(db)
    await login(client, "koord")
    draft = await _generate(db)
    await client.delete(f"/api/v1/scheduling/{draft['id']}")

    actions = (
        await db.scalars(select(AuditEvent.action).where(AuditEvent.action == "schedule.deleted"))
    ).all()
    assert len(actions) == 1
