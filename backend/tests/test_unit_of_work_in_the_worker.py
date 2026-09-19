"""No `AsyncSession` in the worker is used by two concurrent tasks (A05).

`tests/test_unit_of_work_per_request.py` pins the HTTP form of target
architecture rule 2: one request, one session. The worker has no requests, and
its form of the rule is different and stricter - a generation runs a solve and
a progress bar at the same time, so what must hold is **one session per
concurrent task**.

That is not a style preference. An `AsyncSession` is not safe to use from two
tasks at once: the second task's statement can be autoflushed into whatever
transaction the first has open, taking a lock from inside a transaction it does
not control the lifetime of. `worker.py` says this cost a stuck-open
transaction once already (QA7 par. 8, G4), and the fix - progress writes on
their own session - is a structure nothing was checking.

These tests watch every statement the worker issues and record which asyncio
task issued it.

The check is deliberately narrower than "no session is ever seen by two tasks".
That broader statement is false and would be a bad test: `process_schedule_run`
legitimately hands its own session to the generation task and takes it back
afterwards, which is a handover, not sharing. What matters is overlap in time,
so the window while the generation task is alive is isolated first and the
disjointness is asserted only inside it.
"""

import asyncio
from datetime import date, timedelta
from typing import Any

import pytest
from sqlalchemy import event, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Session

from oncall.models import ScheduleRun, UserRole
from oncall.scheduler import MODEL_BUILT, SOLVE_DONE, SOLVE_PASS
from oncall.worker import process_schedule_run
from tests.conftest import create_user, staged_draft

GENERATION_TASK = "probe-generation"


class _SessionUse:
    """Which asyncio task touched which session, in order."""

    def __init__(self) -> None:
        self.uses: list[tuple[int, str]] = []

    def record(self, orm_execute_state: Any) -> None:
        task = asyncio.current_task()
        # A statement issued outside a task cannot collide with another task,
        # so it is not evidence either way and is left out.
        if task is not None:
            self.uses.append((id(orm_execute_state.session), task.get_name()))

    def tasks_per_session(self) -> dict[int, set[str]]:
        shared: dict[int, set[str]] = {}
        for session_id, task_name in self.uses:
            shared.setdefault(session_id, set()).add(task_name)
        return shared

    def sessions_of(self, task_name: str) -> set[int]:
        return {session for session, task in self.uses if task == task_name}


@pytest.fixture
def session_use() -> Any:
    """Record every ORM statement, on any session, with its asyncio task."""
    recorder = _SessionUse()
    event.listen(Session, "do_orm_execute", recorder.record)
    yield recorder
    event.remove(Session, "do_orm_execute", recorder.record)


class _Clock:
    """Six seconds per read, so one loop pass covers a visible slice of the
    budget without the test waiting that long."""

    def __init__(self) -> None:
        self.now = 0.0

    def monotonic(self) -> float:
        self.now += 6.0
        return self.now


async def _queued_run(db: AsyncSession) -> ScheduleRun:
    user = await create_user(db, "koord.uow", role=UserRole.coordinator)
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
    return run


async def test_the_progress_bar_never_writes_through_the_generation_session(
    db: AsyncSession,
    db_factory: async_sessionmaker[AsyncSession],
    session_use: _SessionUse,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The documented fix, stated as a structure rather than as a comment."""
    await _queued_run(db)

    async def fake_generate(_request, _user, session, progress=None):
        assert progress is not None
        progress(MODEL_BUILT)
        progress(f"{SOLVE_PASS} 15")
        for _ in range(2):
            await asyncio.sleep(1.4)
        progress(SOLVE_DONE)
        # Real work on the generation's own session, so it is a genuine
        # concurrent user of `db` rather than an idle placeholder.
        await session.scalar(select(ScheduleRun).limit(1))
        return await staged_draft(session)

    monkeypatch.setattr("oncall.worker.generate_draft", fake_generate)
    monkeypatch.setattr("oncall.worker.SessionFactory", db_factory)
    monkeypatch.setattr("oncall.worker.time", _Clock())

    assert await process_schedule_run(db) == 1

    progress_sessions = {
        session_id
        for session_id, tasks in session_use.tasks_per_session().items()
        if session_id != id(db.sync_session)
    }
    assert progress_sessions, "the progress loop never wrote, so nothing was proven"


async def test_no_session_is_used_by_two_tasks_at_once(
    db: AsyncSession,
    db_factory: async_sessionmaker[AsyncSession],
    session_use: _SessionUse,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The invariant itself, over a run with a solve and a bar in flight."""
    await _queued_run(db)
    window: dict[str, int] = {}

    async def fake_generate(_request, _user, session, progress=None):
        assert progress is not None
        # Bracket the statements issued while this task is alive: only those
        # can overlap with the progress loop, and only they are evidence.
        window["opened"] = len(session_use.uses)
        progress(MODEL_BUILT)
        progress(f"{SOLVE_PASS} 15")
        for _ in range(2):
            await asyncio.sleep(1.4)
            await session.scalar(select(ScheduleRun).limit(1))
        progress(SOLVE_DONE)
        staged = await staged_draft(session)
        window["closed"] = len(session_use.uses)
        return staged

    monkeypatch.setattr("oncall.worker.generate_draft", fake_generate)
    monkeypatch.setattr("oncall.worker.SessionFactory", db_factory)
    monkeypatch.setattr("oncall.worker.time", _Clock())

    assert await process_schedule_run(db) == 1

    overlapping = session_use.uses[window["opened"] : window["closed"]]
    assert overlapping, "the generation task issued nothing, so nothing overlapped"

    per_session: dict[int, set[str]] = {}
    for session_id, task_name in overlapping:
        per_session.setdefault(session_id, set()).add(task_name)
    shared = {session: tasks for session, tasks in per_session.items() if len(tasks) > 1}

    assert shared == {}, shared


async def test_the_probe_would_notice_a_shared_session() -> None:
    """Without this, a green run could mean the recorder simply saw nothing.

    Two tasks deliberately share one session; the same bookkeeping the tests
    above rely on has to report it.
    """
    recorder = _SessionUse()
    recorder.uses = [(1, "task-a"), (1, "task-b"), (2, "task-a")]

    shared = {
        session_id: tasks
        for session_id, tasks in recorder.tasks_per_session().items()
        if len(tasks) > 1
    }

    assert shared == {1: {"task-a", "task-b"}}
    assert recorder.sessions_of("task-a") == {1, 2}
