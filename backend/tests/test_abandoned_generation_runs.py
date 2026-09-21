"""A worker that dies mid-solve must not hold its date range for ever.

A run is claimed by setting it to `running` and committing before the solve
starts, so every kill from then on leaves the row saying `running` with nobody
behind it. `running` is one of `ACTIVE_RUN_STATES`, which is what
`active_run_for` looks for, so the consequence is not untidiness: the
coordinator asks for that fortnight again and is handed the dead run, over and
over, while the browser polls a bar that will never move.

Liveness is read from `updated_at`. The worker's progress loop touches the row
once a second for as long as the generation lives, so a healthy solve stays
fresh however long it takes and the cutoff bounds the gap between heartbeats
rather than the length of a solve. That only holds if the loop really does
touch the row when the bar is standing still, which is what
`test_the_row_stays_fresh_while_the_bar_stands_still` measures rather than
assumes.
"""

import asyncio
from datetime import date, timedelta

import pytest
from sqlalchemy import select

from oncall.domain.clock import utc_now
from oncall.domain.scheduling.generation import ABANDONED_RUN_ERROR, recover_abandoned_runs
from oncall.domain.vocabulary import UserRole
from oncall.infrastructure.sqlalchemy.scheduling_generation import SqlAlchemyGenerationQueue
from oncall.infrastructure.sqlalchemy.scheduling_models import ScheduleRun
from oncall.scheduler import MODEL_BUILT, SOLVE_DONE, SOLVE_PASS
from oncall.worker import generation_cycle, process_schedule_run
from tests.conftest import create_user, staged_draft

#: The default from `Settings.stale_run_seconds`, restated here so a change to
#: it has to be made deliberately in both places.
CUTOFF = 120.0

STARTS = date.today() + timedelta(days=10)
ENDS = STARTS + timedelta(days=6)


class _Clock:
    """Six seconds per read, so one loop pass covers a visible slice of the
    budget without the test waiting that long."""

    def __init__(self) -> None:
        self.now = 0.0

    def monotonic(self) -> float:
        self.now += 6.0
        return self.now


async def _run(db, *, status: str, age_seconds: float, offset_days: int = 0) -> ScheduleRun:
    user = await create_user(db, f"koord.{status}.{offset_days}", role=UserRole.coordinator)
    run = ScheduleRun(
        starts_on=STARTS + timedelta(days=offset_days),
        ends_on=ENDS + timedelta(days=offset_days),
        requested_by_id=user.id,
        status=status,
        progress=30 if status == "running" else 0,
        updated_at=utc_now() - timedelta(seconds=age_seconds),
    )
    db.add(run)
    await db.commit()
    return run


async def _recover(db) -> int:
    reclaimed = await recover_abandoned_runs(
        SqlAlchemyGenerationQueue(db), stale_after=CUTOFF, now=utc_now()
    )
    await db.commit()
    return reclaimed


async def _as_stored(db_factory, run_id) -> ScheduleRun:
    """Read the run the way the polling client does, on a session that has
    never seen it. The recovery is a bulk statement that synchronises nothing,
    so the session that ran it still holds the row as it was."""
    async with db_factory() as reader:
        stored = await reader.get(ScheduleRun, run_id)
        assert stored is not None
        return stored


async def test_a_dead_run_stops_holding_its_range(db, db_factory) -> None:
    """The reproduction: without recovery the range is blocked for ever."""
    run = await _run(db, status="running", age_seconds=3 * 60 * 60)
    queue = SqlAlchemyGenerationQueue(db)

    blocking = await queue.active_run_for(STARTS, ENDS)
    assert blocking is not None and blocking.id == run.id

    assert await _recover(db) == 1

    assert await queue.active_run_for(STARTS, ENDS) is None
    reclaimed = await _as_stored(db_factory, run.id)
    assert reclaimed.status == "failed"
    assert reclaimed.progress == 100
    assert reclaimed.error == ABANDONED_RUN_ERROR


@pytest.mark.parametrize("age_seconds", [0.0, CUTOFF - 60])
async def test_a_run_touched_recently_enough_is_left_alone(
    db, db_factory, age_seconds: float
) -> None:
    """The cutoff is a boundary, not a mood. A solve that has been beating
    within the window is somebody's live work."""
    run = await _run(db, status="running", age_seconds=age_seconds)

    assert await _recover(db) == 0

    assert (await _as_stored(db_factory, run.id)).status == "running"


async def test_a_queued_run_is_never_reclaimed_however_old(db, db_factory) -> None:
    """Nothing has claimed it, so nothing died holding it. An old `queued` row
    means the worker is down or the queue is long, and failing it would throw
    away a request that is still perfectly good."""
    run = await _run(db, status="queued", age_seconds=7 * 24 * 60 * 60)

    assert await _recover(db) == 0

    assert (await _as_stored(db_factory, run.id)).status == "queued"


async def test_recovery_survives_a_session_that_has_already_read_the_run(db) -> None:
    """The recovery statement must not be evaluated in Python.

    SQLAlchemy synchronises an ORM-enabled UPDATE by default, which for this
    statement means comparing `updated_at` against the cutoff in Python for
    every run the session holds. SQLite returns those timestamps naive while
    the cutoff is UTC-aware, and that comparison raises rather than returning
    False - so the failure would be a crash in the worker, not a missed run.
    """
    run = await _run(db, status="running", age_seconds=3 * 60 * 60)
    db.expunge_all()
    loaded = await db.get(ScheduleRun, run.id)
    assert loaded is not None

    assert await _recover(db) == 1


async def test_a_generation_lane_reclaims_before_it_claims(db, db_factory) -> None:
    """Pins the call site, not only the statement.

    Every other test here drives `recover_abandoned_runs` by hand, so all of
    them would still pass if the worker simply never called it. This one runs
    the lane's own cycle.
    """
    run = await _run(db, status="running", age_seconds=3 * 60 * 60)

    assert await generation_cycle(db_factory) == 0, "the queue was meant to be empty"

    assert (await _as_stored(db_factory, run.id)).status == "failed"


async def test_the_row_stays_fresh_while_the_bar_stands_still(db, db_factory, monkeypatch) -> None:
    """The heartbeat is the whole basis of the cutoff, so it is measured here.

    This generation never announces a milestone, so the bar sits at its claimed
    value throughout - the state the real worker is in while it builds the
    model, and again while it stores the finished draft. `updated_at` still has
    to move, or a long model build would be reclaimed out from under a healthy
    worker.
    """
    await _run(db, status="queued", age_seconds=0)
    run_id_holder: list = []
    samples: list = []

    async def fake_generate(_request, _user, session, progress=None):
        for _ in range(3):
            await asyncio.sleep(1.4)
            async with db_factory() as reader:
                row = await reader.execute(
                    select(ScheduleRun.updated_at, ScheduleRun.progress).where(
                        ScheduleRun.id == run_id_holder[0]
                    )
                )
                samples.append(row.one())
        return await staged_draft(session)

    monkeypatch.setattr("oncall.worker.generate_draft", fake_generate)
    monkeypatch.setattr("oncall.worker.time", _Clock())

    claimed = await db.scalar(select(ScheduleRun))
    run_id_holder.append(claimed.id)

    assert await process_schedule_run(db_factory) == 1

    stamps = [stamp for stamp, _progress in samples]
    bar = {value for _stamp, value in samples}
    assert bar == {10}, samples
    assert len(set(stamps)) >= 2, samples
    assert stamps == sorted(stamps), samples


async def test_a_reclaimed_run_is_not_resurrected_by_the_worker_that_lost_it(
    db, db_factory, monkeypatch
) -> None:
    """The other half of the race, and the reason the recovery is safe.

    A lane can stall past the cutoff - a frozen container, a database round
    trip that hangs - have its run declared abandoned, and then wake up and
    finish. Writing `completed` at that point would revive a run the
    coordinator was already told had failed and may have replaced by hand, so
    the late writer has to lose.
    """
    await _run(db, status="queued", age_seconds=0)
    claimed = await db.scalar(select(ScheduleRun))
    run_id = claimed.id

    async def fake_generate(_request, _user, session, progress=None):
        assert progress is not None
        progress(MODEL_BUILT)
        progress(f"{SOLVE_PASS} 15")
        await asyncio.sleep(1.4)
        # Somebody else decides this lane is gone and reclaims the run.
        async with db_factory() as other:
            assert (
                await recover_abandoned_runs(
                    SqlAlchemyGenerationQueue(other),
                    stale_after=0.0,
                    now=utc_now() + timedelta(seconds=1),
                )
                == 1
            )
            await other.commit()
        await asyncio.sleep(1.4)
        progress(SOLVE_DONE)
        return await staged_draft(session)

    monkeypatch.setattr("oncall.worker.generate_draft", fake_generate)
    monkeypatch.setattr("oncall.worker.time", _Clock())

    assert await process_schedule_run(db_factory) == 1

    final = await _as_stored(db_factory, run_id)
    assert final.status == "failed"
    assert final.error == ABANDONED_RUN_ERROR
    assert final.schedule_id is None
    # The heartbeat carries the same predicate, so the bar does not walk back
    # down from 100 while the lane it no longer belongs to finishes its solve.
    assert final.progress == 100
