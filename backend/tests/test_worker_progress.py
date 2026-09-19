"""Pasek postępu generowania rusza się w trakcie solvowania (MED5-11).

`worker.py` ustawiał 30 po zbudowaniu modelu i 90 dopiero po jego rozwiązaniu,
więc przy budżecie 90 sekund pasek stał przez większość przebiegu. Teraz jest
interpolowany po budżecie wszystkich zapowiedzianych przebiegów solvera.
"""

import asyncio
from datetime import date, timedelta

from sqlalchemy import select

from oncall.models import ScheduleRun, UserRole
from oncall.scheduler import MODEL_BUILT, SOLVE_DONE, SOLVE_PASS
from oncall.worker import (
    CLAIMED_PROGRESS,
    MODEL_BUILT_PROGRESS,
    SOLVE_DONE_PROGRESS,
    _Bar,
    process_schedule_run,
    solve_progress,
)
from tests.conftest import create_user, staged_draft


def test_progress_moves_with_the_time_spent_searching() -> None:
    walk = [solve_progress(elapsed, announced=15.0) for elapsed in (0, 3, 7, 11, 15)]
    assert walk == sorted(walk), walk
    assert len(set(walk)) == len(walk), walk
    assert walk[0] == MODEL_BUILT_PROGRESS


def test_progress_never_claims_the_solve_finished() -> None:
    """Only the `solve_done` milestone may set the end of the span."""
    assert solve_progress(15.0, 15.0) < SOLVE_DONE_PROGRESS
    assert solve_progress(10_000.0, 15.0) < SOLVE_DONE_PROGRESS
    assert solve_progress(15.0, 15.0) == SOLVE_DONE_PROGRESS - 1


def test_a_second_announced_pass_slows_the_bar_instead_of_pinning_it() -> None:
    """The measured hard branch spends about 25 s on a 15 s budget, because it
    solves several models in sequence (par. 3 planu naprawczego)."""
    one_pass = solve_progress(15.0, announced=15.0)
    two_passes = solve_progress(15.0, announced=30.0)
    assert two_passes < one_pass
    # And it keeps climbing through the second pass rather than standing still.
    assert solve_progress(15.0, 30.0) < solve_progress(22.0, 30.0) < one_pass


def test_no_announced_budget_leaves_the_bar_at_the_milestone() -> None:
    assert solve_progress(5.0, announced=0.0) == MODEL_BUILT_PROGRESS


class _Clock:
    """Reads jump six seconds, so one real loop pass covers a visible slice of
    a fifteen second budget without the test sleeping that long."""

    def __init__(self) -> None:
        self.now = 0.0

    def monotonic(self) -> float:
        self.now += 6.0
        return self.now


def _bar(monkeypatch) -> _Bar:
    monkeypatch.setattr("oncall.worker.time", _Clock())
    return _Bar(progress=CLAIMED_PROGRESS)


def test_the_bar_waits_for_the_model_before_it_moves(monkeypatch) -> None:
    """Until the solver has a model there is nothing to interpolate against,
    and the loop is still writing - that write is the run's heartbeat."""
    bar = _bar(monkeypatch)

    assert bar.advance([]) == CLAIMED_PROGRESS
    assert bar.advance([f"{SOLVE_PASS} 15"]) == CLAIMED_PROGRESS


def test_the_model_milestone_starts_the_clock_and_the_span(monkeypatch) -> None:
    bar = _bar(monkeypatch)

    assert bar.advance([MODEL_BUILT]) == MODEL_BUILT_PROGRESS
    assert bar.started_at is not None


def test_each_milestone_is_read_once_however_often_the_loop_looks(monkeypatch) -> None:
    """The list is appended from the solver thread while this reads it. Reading
    by index is what makes a concurrent append safe; counting the same
    `solve_pass` twice would double the denominator and stall the bar."""
    bar = _bar(monkeypatch)
    milestones = [MODEL_BUILT, f"{SOLVE_PASS} 15"]

    bar.advance(milestones)
    assert bar.announced == 15.0
    bar.advance(milestones)
    assert bar.announced == 15.0

    milestones.append(f"{SOLVE_PASS} 30")
    bar.advance(milestones)
    assert bar.announced == 45.0


def test_the_bar_never_walks_backwards_when_a_pass_is_announced(monkeypatch) -> None:
    """A run that has to prove the acceptance criterion unattainable announces
    another budget mid-flight, which grows the denominator."""
    bar = _bar(monkeypatch)
    bar.advance([MODEL_BUILT, f"{SOLVE_PASS} 15"])
    walk = [bar.advance([MODEL_BUILT, f"{SOLVE_PASS} 15"])]
    walk.append(bar.advance([MODEL_BUILT, f"{SOLVE_PASS} 15", f"{SOLVE_PASS} 600"]))

    assert walk == sorted(walk), walk


def test_only_the_milestone_may_claim_the_solve_finished(monkeypatch) -> None:
    bar = _bar(monkeypatch)
    for _ in range(20):
        assert bar.advance([MODEL_BUILT, f"{SOLVE_PASS} 15"]) < SOLVE_DONE_PROGRESS

    assert bar.advance([MODEL_BUILT, f"{SOLVE_PASS} 15", SOLVE_DONE]) == SOLVE_DONE_PROGRESS
    # And it stays there while the draft is stored, rather than resuming the
    # interpolation it was in the middle of.
    assert bar.advance([MODEL_BUILT, f"{SOLVE_PASS} 15", SOLVE_DONE]) == SOLVE_DONE_PROGRESS


async def test_the_worker_writes_a_moving_bar_between_the_milestones(
    db, db_factory, monkeypatch
) -> None:
    user = await create_user(db, "koord.progress", role=UserRole.coordinator)
    run = ScheduleRun(
        starts_on=date.today() + timedelta(days=1),
        ends_on=date.today() + timedelta(days=7),
        requested_by_id=user.id,
        status="queued",
        progress=0,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)

    run_id = run.id
    samples: list[int] = []

    async def fake_generate(_request, _user, session, progress=None):
        assert progress is not None
        progress(MODEL_BUILT)
        progress(f"{SOLVE_PASS} 15")
        for _ in range(3):
            await asyncio.sleep(1.4)
            # Read back through a fresh session, like any other client would:
            # the polling loop in `process_schedule_run` writes progress only
            # to the row (via its own separate session), never to `run`
            # itself, since `run` is bound to the session `generate_draft` is
            # concurrently using (QA7 par. 8, G4 - mutating it from here used
            # to smuggle an autoflushed UPDATE into that other session's open
            # transaction and could leave it stuck open forever).
            async with db_factory() as reader:
                query = select(ScheduleRun.progress).where(ScheduleRun.id == run_id)
                samples.append(await reader.scalar(query))
        progress(SOLVE_DONE)
        return await staged_draft(session)

    monkeypatch.setattr("oncall.worker.generate_draft", fake_generate)
    monkeypatch.setattr("oncall.worker.SessionFactory", db_factory)
    monkeypatch.setattr("oncall.worker.time", _Clock())

    assert await process_schedule_run(db) == 1

    # Filtered rather than indexed: whether the very first sample catches the
    # loop's first write depends on scheduling, but the movement between the
    # two milestones does not.
    moving = [value for value in samples if MODEL_BUILT_PROGRESS < value < SOLVE_DONE_PROGRESS]
    assert len(set(moving)) >= 2, samples
    assert moving == sorted(moving), samples
    assert samples == sorted(samples), samples
    assert run.status == "completed"
    assert run.progress == 100
