"""Queue transparency and de-duplication for schedule generation.

HGH6-05 / MED6-05: a generation used to block the notification drain behind it,
two coordinators queuing the same range got two indistinguishable drafts, and a
queued run gave no hint of how long it would wait.
"""

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select

from oncall.domain.scheduling.models import RunState
from oncall.domain.vocabulary import UserRole
from oncall.infrastructure.sqlalchemy.scheduling_models import DEFAULT_SOLVE_SECONDS, ScheduleRun
from oncall.scheduler import total_time_budget
from oncall.worker import _claim_run, generation_cycle, notification_cycle
from tests.conftest import create_user, login, staged_draft


async def _queued(db, user_id, start, *, created_at):
    run = ScheduleRun(
        starts_on=start,
        ends_on=start + timedelta(days=13),
        requested_by_id=user_id,
        status="queued",
        progress=0,
        created_at=created_at,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    return run


@pytest.mark.anyio
async def test_a_queued_run_reports_how_many_are_ahead(client, db) -> None:
    user = await create_user(db, "koord.q", role=UserRole.coordinator)
    base = datetime(2027, 6, 1, tzinfo=UTC)
    first = await _queued(db, user.id, date(2027, 7, 1), created_at=base)
    await _queued(db, user.id, date(2027, 8, 1), created_at=base + timedelta(seconds=1))
    third = await _queued(db, user.id, date(2027, 9, 1), created_at=base + timedelta(seconds=2))

    await login(client, "koord.q")
    body = (await client.get(f"/api/v1/scheduling/runs/{third.id}")).json()
    assert body["queue_position"] == 2
    # No finished run to learn a duration from, so the estimate is the hard
    # whole-run ceiling per run ahead (C3), not a mean: two runs ahead on one
    # lane -> 2 x total_time_budget(default 15 s budget).
    assert body["estimated_start_seconds"] == 2 * total_time_budget(DEFAULT_SOLVE_SECONDS)

    head = (await client.get(f"/api/v1/scheduling/runs/{first.id}")).json()
    assert head["queue_position"] == 0
    assert head["estimated_start_seconds"] == 0


@pytest.mark.anyio
async def test_a_running_generation_counts_as_one_ahead(client, db) -> None:
    user = await create_user(db, "koord.q", role=UserRole.coordinator)
    base = datetime(2027, 6, 1, tzinfo=UTC)
    db.add(
        ScheduleRun(
            starts_on=date(2027, 7, 1),
            ends_on=date(2027, 7, 14),
            requested_by_id=user.id,
            status="running",
            progress=30,
            created_at=base,
        )
    )
    await db.commit()
    queued = await _queued(db, user.id, date(2027, 8, 1), created_at=base + timedelta(seconds=1))

    await login(client, "koord.q")
    body = (await client.get(f"/api/v1/scheduling/runs/{queued.id}")).json()
    assert body["queue_position"] == 1


@pytest.mark.anyio
async def test_a_finished_run_has_no_queue_position(client, db) -> None:
    user = await create_user(db, "koord.q", role=UserRole.coordinator)
    run = ScheduleRun(
        starts_on=date(2027, 7, 1),
        ends_on=date(2027, 7, 14),
        requested_by_id=user.id,
        status="completed",
        progress=100,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)

    await login(client, "koord.q")
    body = (await client.get(f"/api/v1/scheduling/runs/{run.id}")).json()
    assert body["queue_position"] is None
    assert body["estimated_start_seconds"] is None


@pytest.mark.anyio
async def test_second_generation_of_the_same_range_returns_the_first(client, db) -> None:
    await create_user(db, "koord.a", role=UserRole.coordinator)
    await create_user(db, "koord.b", role=UserRole.coordinator)
    payload = {"starts_on": "2027-06-01", "ends_on": "2027-06-28"}

    await login(client, "koord.a")
    first = await client.post("/api/v1/scheduling/runs", json=payload)
    assert first.status_code == 202, first.text

    await login(client, "koord.b")
    second = await client.post("/api/v1/scheduling/runs", json=payload)
    assert second.status_code == 202, second.text
    assert second.json()["id"] == first.json()["id"]

    rows = (
        await db.scalars(select(ScheduleRun).where(ScheduleRun.starts_on == date(2027, 6, 1)))
    ).all()
    assert len(rows) == 1


@pytest.mark.anyio
async def test_a_different_range_is_queued_on_its_own(client, db) -> None:
    await create_user(db, "koord.a", role=UserRole.coordinator)
    await login(client, "koord.a")
    first = await client.post(
        "/api/v1/scheduling/runs",
        json={"starts_on": "2027-06-01", "ends_on": "2027-06-28"},
    )
    second = await client.post(
        "/api/v1/scheduling/runs",
        json={"starts_on": "2027-07-01", "ends_on": "2027-07-28"},
    )
    assert first.json()["id"] != second.json()["id"]


@pytest.mark.anyio
async def test_a_completed_run_of_the_same_range_does_not_block_a_new_one(client, db) -> None:
    user = await create_user(db, "koord.a", role=UserRole.coordinator)
    db.add(
        ScheduleRun(
            starts_on=date(2027, 6, 1),
            ends_on=date(2027, 6, 28),
            requested_by_id=user.id,
            status="completed",
            progress=100,
        )
    )
    await db.commit()

    await login(client, "koord.a")
    fresh = await client.post(
        "/api/v1/scheduling/runs",
        json={"starts_on": "2027-06-01", "ends_on": "2027-06-28"},
    )
    assert fresh.status_code == 202
    assert fresh.json()["status"] == "queued"


@pytest.mark.anyio
async def test_notification_cycle_leaves_a_queued_generation_alone(db, db_factory) -> None:
    user = await create_user(db, "koord.split", role=UserRole.coordinator)
    run = ScheduleRun(
        starts_on=date(2027, 7, 1),
        ends_on=date(2027, 7, 14),
        requested_by_id=user.id,
        status="queued",
        progress=0,
    )
    db.add(run)
    await db.commit()

    stats = await notification_cycle(db_factory)
    assert "schedule_runs" not in stats

    await db.refresh(run)
    assert run.status == "queued"


@pytest.mark.anyio
async def test_generation_cycle_claims_one_queued_run(db, db_factory, monkeypatch) -> None:
    async def fake_generate(_request, _user, session, progress=None):
        return await staged_draft(session, starts_on=date(2027, 7, 1))

    monkeypatch.setattr("oncall.worker.generate_draft", fake_generate)
    user = await create_user(db, "koord.gen", role=UserRole.coordinator)
    run = ScheduleRun(
        starts_on=date(2027, 7, 1),
        ends_on=date(2027, 7, 14),
        requested_by_id=user.id,
        status="queued",
        progress=0,
    )
    db.add(run)
    await db.commit()

    assert await generation_cycle(db_factory) == 1
    await db.refresh(run)
    assert run.status == "completed"

    assert await generation_cycle(db_factory) == 0


@pytest.mark.anyio
async def test_the_oldest_queued_run_is_claimed_first(db, db_factory) -> None:
    """The queue is first in, first out, and the coordinator is told so.

    `queue_position` counts the active runs queued before theirs, so a lane
    that took the newest run instead would make that number a lie: somebody
    told nobody was ahead of them would sit behind every later arrival.
    """
    user = await create_user(db, "koord.fifo", role=UserRole.coordinator)
    now = datetime.now(UTC)
    newest = await _queued(db, user.id, date(2027, 9, 1), created_at=now)
    oldest = await _queued(db, user.id, date(2027, 10, 1), created_at=now - timedelta(minutes=5))

    claimed = await _claim_run(db_factory)

    assert claimed is not None
    assert claimed.id == oldest.id, "the later request was claimed first"
    assert claimed.status == RunState.running
    await db.refresh(newest)
    assert newest.status == RunState.queued
