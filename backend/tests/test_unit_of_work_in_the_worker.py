"""Units of work in the worker: one per step, one session per concurrent task.

`tests/test_unit_of_work_per_request.py` pins the HTTP form of target
architecture rule 2: one request, one session. The worker has no requests, and
its form of the rule is different and stricter. A generation is a sequence of
named steps - recover, claim, solve-and-store, heartbeat and finish - and each
opens exactly one `SqlAlchemyUnitOfWork`, which is the only thing that commits.
A solve and its progress bar also run at the same time, so what must hold on
top of that is **one session per concurrent task**.

That is not a style preference. An `AsyncSession` is not safe to use from two
tasks at once: the second task's statement can be autoflushed into whatever
transaction the first has open, taking a lock from inside a transaction it does
not control the lifetime of. That once cost a stuck-open transaction (QA7
par. 8, G4), and the fix - progress writes on sessions of their own - is a
structure these tests check rather than trust.

The session check watches every statement the worker issues and records which
asyncio task issued it. It is deliberately narrower than "no session is ever
seen by two tasks": what matters is overlap in time, so the window while the
generation task is alive is isolated first and the disjointness is asserted
only inside it.
"""

import asyncio
from datetime import date, timedelta
from typing import Any

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlalchemy.orm import Session

from oncall.domain.scheduling.models import RunState
from oncall.domain.vocabulary import UserRole
from oncall.infrastructure.sqlalchemy.scheduling_models import Schedule, ScheduleRun
from oncall.scheduler import MODEL_BUILT, SOLVE_DONE, SOLVE_PASS
from oncall.worker import generation_cycle, process_schedule_run
from tests.conftest import create_user, staged_draft


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


class _Sessions:
    """The test's session factory, remembering every session it hands out and
    how each one ended."""

    def __init__(
        self, factory: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
    ) -> None:
        self._factory = factory
        self.opened: list[AsyncSession] = []
        self.commits: dict[int, int] = {}
        self.closes: dict[int, int] = {}
        commit, close = AsyncSession.commit, AsyncSession.close

        async def counted_commit(session: AsyncSession) -> None:
            self.commits[id(session)] = self.commits.get(id(session), 0) + 1
            await commit(session)

        async def counted_close(session: AsyncSession) -> None:
            self.closes[id(session)] = self.closes.get(id(session), 0) + 1
            await close(session)

        monkeypatch.setattr(AsyncSession, "commit", counted_commit)
        monkeypatch.setattr(AsyncSession, "close", counted_close)

    def __call__(self) -> AsyncSession:
        session = self._factory()
        self.opened.append(session)
        return session

    def in_transaction(self) -> list[AsyncSession]:
        return [session for session in self.opened if session.in_transaction()]

    def endings(self) -> list[tuple[int, int]]:
        """(commits, closes) of every session handed out, in order."""
        return [
            (self.commits.get(id(session), 0), self.closes.get(id(session), 0))
            for session in self.opened
        ]


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
    generation: dict[str, Any] = {}

    async def fake_generate(_request, _user, session, progress=None):
        assert progress is not None
        # Only while this session is alive is its id its own; a session closed
        # earlier may have had the same one.
        generation["opened"] = len(session_use.uses)
        generation["session"] = id(session.sync_session)
        generation["task"] = asyncio.current_task().get_name()
        progress(MODEL_BUILT)
        progress(f"{SOLVE_PASS} 15")
        for _ in range(2):
            await asyncio.sleep(1.4)
        progress(SOLVE_DONE)
        # Real work on the generation's own session, so it is a genuine
        # concurrent user of it rather than an idle placeholder.
        await session.scalar(select(ScheduleRun).limit(1))
        staged = await staged_draft(session)
        generation["closed"] = len(session_use.uses)
        return staged

    monkeypatch.setattr("oncall.worker.generate_draft", fake_generate)
    monkeypatch.setattr("oncall.worker.time", _Clock())

    assert await process_schedule_run(db_factory) == 1

    progress_sessions = {
        session_id
        for session_id, task in session_use.uses[generation["opened"] : generation["closed"]]
        if task != generation["task"]
    }
    assert progress_sessions, "the progress loop never wrote, so nothing was proven"
    assert generation["session"] not in progress_sessions


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
    monkeypatch.setattr("oncall.worker.time", _Clock())

    assert await process_schedule_run(db_factory) == 1

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


async def test_every_step_is_one_committed_unit_of_work(
    db: AsyncSession, db_factory: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Each session the worker opens is a unit of work: committed once, closed.

    A step that managed its own session - a factory call with a commit of its
    own, a second commit, or none - shows up here as a session that did not
    end exactly this way. An idle lane is two steps, recover and claim; a
    generation adds solve-and-store, its heartbeats and the finish.
    """
    await _queued_run(db)

    async def fake_generate(_request, _user, session, progress=None):
        await asyncio.sleep(1.4)
        return await staged_draft(session)

    monkeypatch.setattr("oncall.worker.generate_draft", fake_generate)
    monkeypatch.setattr("oncall.worker.time", _Clock())
    sessions = _Sessions(db_factory, monkeypatch)

    assert await generation_cycle(sessions) == 1

    # recover, claim, solve-and-store, at least one heartbeat, finish.
    assert len(sessions.opened) >= 5
    assert sessions.endings() == [(1, 1)] * len(sessions.opened)

    idle = _Sessions(db_factory, monkeypatch)
    assert await generation_cycle(idle) == 0
    assert idle.endings() == [(1, 1), (1, 1)], "an idle lane is recover and claim"


async def test_the_claim_is_committed_before_the_solve_starts(
    db: AsyncSession, db_factory: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    """While the generator works, the only transaction the lane has open is
    the generation's own: the claim's, and the lock `SKIP LOCKED` took with it,
    ended before the solve began."""
    run = await _queued_run(db)
    seen: dict[str, Any] = {}

    async def fake_generate(_request, _user, session, progress=None):
        # Checked before the progress loop's first beat, so a heartbeat in
        # flight cannot be mistaken for a transaction left open.
        seen["open"] = sessions.in_transaction()
        seen["own"] = session
        async with db_factory() as reader:
            seen["status"] = await reader.scalar(
                select(ScheduleRun.status).where(ScheduleRun.id == run.id)
            )
        return await staged_draft(session)

    monkeypatch.setattr("oncall.worker.generate_draft", fake_generate)
    monkeypatch.setattr("oncall.worker.time", _Clock())
    sessions = _Sessions(db_factory, monkeypatch)

    assert await process_schedule_run(sessions) == 1

    assert seen["open"] == [seen["own"]]
    assert seen["status"] == RunState.running, "the claim was not visible to anybody else"


async def test_a_generation_that_fails_after_staging_leaves_no_draft(
    db: AsyncSession, db_factory: async_sessionmaker[AsyncSession], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Solve-and-store is one unit of work, so its failure takes all of it back.

    The draft used to be staged on the lane's session, and a failure after that
    point left it staged there for the finish step's commit to write: the run
    said `failed` while a draft nobody asked to keep sat in the database.
    """
    run = await _queued_run(db)

    async def fake_generate(_request, _user, session, progress=None):
        await staged_draft(session)
        raise RuntimeError("zapis dziennika się nie udał")

    monkeypatch.setattr("oncall.worker.generate_draft", fake_generate)
    monkeypatch.setattr("oncall.worker.time", _Clock())

    assert await process_schedule_run(db_factory) == 1

    async with db_factory() as reader:
        assert await reader.scalar(select(func.count()).select_from(Schedule)) == 0
        stored = await reader.get(ScheduleRun, run.id)
        assert stored is not None
        assert stored.status == RunState.failed
        assert stored.error == "zapis dziennika się nie udał"
