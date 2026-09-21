"""A generated draft must remain reachable after the page is reloaded.

Before these endpoints existed the result lived only in frontend component
state, so a refresh orphaned the draft in the database permanently.
"""

import uuid
from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.domain.vocabulary import ScheduleStatus, UserRole
from oncall.infrastructure.sqlalchemy.scheduling_models import Schedule
from tests.conftest import create_member, create_user, generate_draft_directly, login

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
async def test_draft_can_be_fetched_again_after_generation(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _team(db)
    await login(client, "koord")
    draft = await _generate(db)

    assert draft["name"] == (
        f"Szkic hybrydowy {START:%d-%m-%Y} - {(START + timedelta(days=6)):%d-%m-%Y}"
    )

    # Simulates a page reload: same id, no in-memory state.
    again = await client.get(f"/api/v1/scheduling/{draft['id']}")
    assert again.status_code == 200, again.text
    assert again.json() == draft
    # LOW6-07: the criterion floor is on the draft itself, not only on
    # fairness-impact.
    assert "acceptance_floor" in draft


@pytest.mark.anyio
async def test_drafts_listing_finds_an_orphaned_draft(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _team(db)
    await login(client, "koord")
    draft = await _generate(db)

    listing = await client.get("/api/v1/scheduling/drafts")
    assert listing.status_code == 200, listing.text
    ids = [item["id"] for item in listing.json()]
    assert draft["id"] in ids
    entry = next(item for item in listing.json() if item["id"] == draft["id"])
    assert entry["status"] == "draft"
    assert entry["assignment_count"] == len(draft["assignments"])
    assert entry["created_at"] is not None


@pytest.mark.anyio
async def test_listing_keeps_proposals_and_drops_published(
    client: AsyncClient, db: AsyncSession
) -> None:
    await _team(db)
    await login(client, "koord")
    draft = await _generate(db)

    proposed = await client.post(
        f"/api/v1/scheduling/{draft['id']}/propose",
        json={"expected_version": draft["version"]},
    )
    assert proposed.status_code == 200, proposed.text
    listing = (await client.get("/api/v1/scheduling/drafts")).json()
    assert [item["status"] for item in listing if item["id"] == draft["id"]] == ["proposed"]

    # The publish endpoint takes a PostgreSQL advisory lock, which the SQLite
    # test database cannot execute, so the status is moved directly here. What
    # matters for the listing is the filter, not how the row reached that state.
    schedule = await db.get(Schedule, uuid.UUID(draft["id"]))
    assert schedule is not None
    schedule.status = ScheduleStatus.published
    await db.commit()

    listing = (await client.get("/api/v1/scheduling/drafts")).json()
    assert draft["id"] not in [item["id"] for item in listing]


@pytest.mark.anyio
async def test_manual_correction_survives_a_reload(client: AsyncClient, db: AsyncSession) -> None:
    await _team(db)
    await login(client, "koord")
    draft = await _generate(db)
    members = (await client.get("/api/v1/team")).json()
    slot = draft["assignments"][0]
    opposite_names = {
        item["assignee_name"]
        for item in draft["assignments"]
        if item["service_date"] == slot["service_date"]
        and {item["role"], slot["role"]} == {"primary", "secondary"}
    }
    replacement = next(
        member
        for member in members
        if member["display_name"] != slot["assignee_name"]
        and member["display_name"] not in opposite_names
    )

    corrected = await client.post(
        f"/api/v1/scheduling/{draft['id']}/override",
        json={
            "expected_version": draft["version"],
            "service_date": slot["service_date"],
            "role": slot["role"],
            "replacement_member_id": replacement["id"],
        },
    )
    assert corrected.status_code == 200, corrected.text

    reloaded = (await client.get(f"/api/v1/scheduling/{draft['id']}")).json()
    response_payload = corrected.json()

    # The override answer lists only the replacement's rest warnings, while the
    # reload recomputes them for every member of the schedule, so the lists
    # legitimately differ; the correction itself must be identical.
    def as_pairs(payload):
        return {(item["source"], item["message"]) for item in payload["warnings"]}

    assert as_pairs(response_payload) <= as_pairs(reloaded)
    assert {**reloaded, "warnings": []} == {**response_payload, "warnings": []}
    changed = next(
        item
        for item in reloaded["assignments"]
        if item["service_date"] == slot["service_date"] and item["role"] == slot["role"]
    )
    assert changed["assignee_name"] == replacement["display_name"]
    assert changed["is_override"] is True


@pytest.mark.anyio
async def test_members_cannot_read_drafts(client: AsyncClient, db: AsyncSession) -> None:
    await _team(db)
    await login(client, "koord")
    draft = await _generate(db)

    await login(client, "anna")
    assert (await client.get("/api/v1/scheduling/drafts")).status_code == 403
    assert (await client.get(f"/api/v1/scheduling/{draft['id']}")).status_code == 403


@pytest.mark.anyio
async def test_unknown_schedule_is_not_found(client: AsyncClient, db: AsyncSession) -> None:
    await _team(db)
    await login(client, "koord")
    missing = "00000000-0000-0000-0000-000000000000"
    assert (await client.get(f"/api/v1/scheduling/{missing}")).status_code == 404
