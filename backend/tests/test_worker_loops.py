"""The worker's long-running loops, and a run whose requester leaves mid-flight.

Each loop must survive a failed pass - log it, wait, try again - because a
loop that died on the first database hiccup would silently stop that part of
the worker while the others went on looking healthy.
"""

import asyncio
import logging
import runpy
import sys
from datetime import date

import pytest
from sqlalchemy import delete

from oncall import worker
from oncall.config import get_settings
from oncall.domain.scheduling.models import RunOutcome, RunState
from oncall.domain.vocabulary import UserRole
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.scheduling_models import ScheduleRun
from oncall.retention import RetentionReport
from tests.conftest import create_user


class _Stop(BaseException):
    """Ends a loop from inside a test; a loop only catches `Exception`."""


def _scripted(outcomes: list[object]):
    """A cycle that plays back `outcomes`: raise an exception, return a value,
    and stop the loop once the script runs out."""
    calls: list[object] = []

    async def cycle(factory) -> object:
        calls.append(factory)
        if len(calls) > len(outcomes):
            raise _Stop
        outcome = outcomes[len(calls) - 1]
        if isinstance(outcome, BaseException):
            raise outcome
        return outcome

    return cycle, calls


@pytest.fixture
def sleeps(monkeypatch) -> list[float]:
    """Record every pause a loop takes, without taking it."""
    taken: list[float] = []
    real_sleep = asyncio.sleep

    async def fake_sleep(seconds: float) -> None:
        taken.append(seconds)
        await real_sleep(0)

    monkeypatch.setattr(worker.asyncio, "sleep", fake_sleep)
    return taken


async def test_the_notification_loop_logs_a_failed_pass_and_reports_a_busy_one(
    monkeypatch, sleeps, caplog
) -> None:
    caplog.set_level(logging.INFO)
    monkeypatch.setattr(get_settings(), "worker_poll_seconds", 7.0)
    cycle, calls = _scripted([RuntimeError("baza niedostępna"), {"sent": 2}, {"sent": 0}])
    monkeypatch.setattr(worker, "notification_cycle", cycle)
    factory = object()

    with pytest.raises(_Stop):
        await worker._notification_loop(factory)

    assert calls == [factory] * 4
    assert sleeps == [7.0, 7.0, 7.0]
    failures = [r for r in caplog.records if r.getMessage() == "Notification cycle failed"]
    assert len(failures) == 1 and failures[0].exc_info is not None
    reports = [r.getMessage() for r in caplog.records if r.name == "oncall.metrics"]
    # A pass that sent nothing says nothing; one that did work says what.
    assert reports == ["event=notifications sent=2"]


async def test_the_metrics_loop_logs_a_failed_sample_and_keeps_its_rhythm(
    db_factory, monkeypatch, sleeps, caplog
) -> None:
    monkeypatch.setattr(get_settings(), "metrics_interval_seconds", 30.0)
    samples: list[object] = []

    async def failing_sample(db, *, now) -> None:
        samples.append(now)
        if len(samples) > 1:
            raise _Stop
        raise RuntimeError("zapytanie przerwane")

    monkeypatch.setattr(worker, "sample_metrics", failing_sample)

    with pytest.raises(_Stop):
        await worker._metrics_loop(db_factory)

    assert len(samples) == 2
    assert sleeps == [30.0]
    assert any(r.getMessage() == "Metrics sample failed" for r in caplog.records)


async def test_the_retention_loop_logs_a_failed_pass_and_tries_again_next_interval(
    monkeypatch, sleeps, caplog
) -> None:
    monkeypatch.setattr(get_settings(), "retention_interval_seconds", 3600.0)
    cycle, calls = _scripted([RuntimeError("blokada"), RetentionReport()])
    monkeypatch.setattr(worker, "retention_cycle", cycle)

    with pytest.raises(_Stop):
        await worker._retention_loop(object())

    assert len(calls) == 3
    assert sleeps == [3600.0, 3600.0]
    failures = [r for r in caplog.records if r.getMessage() == "Retention cycle failed"]
    assert len(failures) == 1


async def test_a_generation_lane_polls_again_at_once_only_after_it_did_work(
    monkeypatch, sleeps, caplog
) -> None:
    monkeypatch.setattr(get_settings(), "generation_poll_seconds", 2.5)
    cycle, calls = _scripted([1, 0, RuntimeError("zerwane połączenie")])
    monkeypatch.setattr(worker, "generation_cycle", cycle)

    with pytest.raises(_Stop):
        await worker._generation_loop(object())

    assert len(calls) == 4
    # Straight back after a run, the idle poll after an empty queue, and the
    # idle poll after a failure too: a failing lane must not spin.
    assert sleeps == [0, 2.5, 2.5]
    assert any(r.getMessage() == "Generation cycle failed" for r in caplog.records)


async def test_a_requester_deleted_after_the_claim_ends_the_run_as_missing(
    db, db_factory, monkeypatch, caplog
) -> None:
    """The claim read the requester's id; the account is deleted before the
    solve looks it up. The run ends with the same readable reason as a run
    whose requester was gone before it was claimed, and no draft is stored."""
    caplog.set_level(logging.INFO, logger="oncall.metrics")
    user = await create_user(db, "koord.z", role=UserRole.coordinator)
    run = ScheduleRun(
        starts_on=date(2027, 7, 1),
        ends_on=date(2027, 7, 14),
        requested_by_id=user.id,
        status=RunState.queued,
        progress=0,
    )
    db.add(run)
    await db.commit()
    run_id, user_id = run.id, user.id
    claim = worker._claim_run

    async def claim_then_delete_requester(factory):
        claimed = await claim(factory)
        async with factory() as other:
            await other.execute(delete(User).where(User.id == user_id))
            await other.commit()
        return claimed

    async def must_not_generate(*_args, **_kwargs):
        raise AssertionError("the solver ran for a requester that no longer exists")

    monkeypatch.setattr(worker, "_claim_run", claim_then_delete_requester)
    monkeypatch.setattr(worker, "generate_draft", must_not_generate)

    assert await worker.process_schedule_run(db_factory) == 1

    async with db_factory() as reader:
        stored = await reader.get(ScheduleRun, run_id)
    assert stored is not None
    assert stored.status == RunState.failed
    assert stored.error == worker.REQUESTER_MISSING_ERROR
    assert stored.schedule_id is None
    metrics = [r.getMessage() for r in caplog.records if r.name == "oncall.metrics"]
    assert any(f"outcome={RunOutcome.requester_missing}" in line for line in metrics)


def test_running_the_module_starts_the_worker_on_the_process_session_factory(
    monkeypatch,
) -> None:
    """`python -m oncall.worker` is how the container starts the worker."""
    started: list[str] = []
    configured: list[int] = []

    def fake_run(coroutine) -> None:
        started.append(coroutine.cr_code.co_name)
        assert coroutine.cr_frame.f_locals["factory"] is worker.SessionFactory
        coroutine.close()

    monkeypatch.setattr(asyncio, "run", fake_run)
    monkeypatch.setattr(logging, "basicConfig", lambda **kwargs: configured.append(kwargs["level"]))

    # Run as a script, the module is a fresh `__main__`, not the imported one.
    monkeypatch.delitem(sys.modules, "oncall.worker")
    runpy.run_module("oncall.worker", run_name="__main__")

    assert started == ["worker_main"]
    assert configured == [logging.INFO]
