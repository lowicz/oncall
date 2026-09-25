"""What the worker says about itself while it runs (phase 5 item 5).

An operator asking „is anything stuck" had nothing to read: a queue with a run
waiting an hour and an idle queue produced exactly the same output, and a run
that failed said why to the coordinator who asked for it and to nobody else.
These tests hold the numbers that answer those questions - the ages, the
durations, and the category a failure falls into - because a record that is
emitted but carries the wrong number is worse than no record at all.
"""

import asyncio
import logging
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import update

from oncall.config import get_settings
from oncall.domain.scheduling import generation
from oncall.domain.scheduling.errors import GenerationFailed
from oncall.domain.scheduling.models import RunOutcome, RunState
from oncall.domain.vocabulary import UserRole
from oncall.infrastructure.sqlalchemy.notification_models import (
    NotificationOutbox,
    NotificationStatus,
)
from oncall.infrastructure.sqlalchemy.scheduling_generation import SqlAlchemyGenerationQueue
from oncall.infrastructure.sqlalchemy.scheduling_models import ScheduleRun
from oncall.metrics import emit, render
from oncall.notifications.service import outbox_health
from oncall.worker import (
    generation_cycle,
    recover_abandoned,
    sample_metrics,
    worker_main,
)
from tests.conftest import create_user, staged_draft

NOW = datetime(2027, 5, 1, 12, 0, tzinfo=UTC)


@pytest.fixture(autouse=True)
def measurements(caplog):
    """Every test here reads the metrics channel."""
    caplog.set_level(logging.INFO, logger="oncall.metrics")
    return caplog


def _records(caplog, event: str) -> list[dict[str, str]]:
    """The fields of every record of one event, parsed back out of logfmt."""
    found = []
    for record in caplog.records:
        # The channel is its own logger precisely so it can be read apart from
        # the worker's narrative log; this reads it the same way.
        if record.name != "oncall.metrics":
            continue
        fields = dict(part.split("=", 1) for part in record.getMessage().split(" "))
        if fields.pop("event") == event:
            found.append(fields)
    return found


def _only(caplog, event: str) -> dict[str, str]:
    records = _records(caplog, event)
    assert len(records) == 1, f"expected one {event} record, got {len(records)}"
    return records[0]


# ---------------------------------------------------------------- the format


def test_a_record_names_its_event_first_and_its_fields_after() -> None:
    assert render("queue", {"queued": 3, "running": 1}) == "event=queue queued=3 running=1"


def test_durations_read_the_same_wherever_they_were_measured() -> None:
    """One decimal place, fixed in the renderer: a duration is not more precise
    for having been measured by a monotonic clock."""
    assert render("generation", {"run_seconds": 12.3456}) == "event=generation run_seconds=12.3"
    assert render("generation", {"run_seconds": 12.0}) == "event=generation run_seconds=12.0"


def test_a_measurement_carries_its_severity_rather_than_a_second_line(caplog) -> None:
    caplog.set_level(logging.WARNING, logger="oncall.metrics")
    emit("generation_abandoned", level=logging.WARNING, runs=2)

    record = caplog.records[-1]
    assert record.name == "oncall.metrics"
    assert record.levelno == logging.WARNING
    assert record.getMessage() == "event=generation_abandoned runs=2"


# ----------------------------------------------------------------- the queue


async def _run(db, *, status: str, created: datetime, updated: datetime | None = None, day: int):
    run = ScheduleRun(
        starts_on=date(2027, 6, day),
        ends_on=date(2027, 6, day),
        status=status,
        progress=0,
        created_at=created,
        updated_at=updated or created,
    )
    db.add(run)
    await db.commit()
    return run


async def test_an_empty_queue_reads_as_empty_rather_than_as_silence(db) -> None:
    health = await generation.queue_health(SqlAlchemyGenerationQueue(db), now=NOW)

    assert health == generation.QueueHealth(
        queued=0, running=0, oldest_queued_seconds=0.0, stalest_running_seconds=0.0
    )


async def test_the_queue_age_is_the_longest_wait_not_the_shortest(db) -> None:
    """The number an operator watches is how long the person who has waited
    longest has been waiting. Reported off the newest row instead, a queue
    filling up faster than it drains would look permanently healthy."""
    await _run(db, status=RunState.queued, created=NOW - timedelta(seconds=300), day=1)
    await _run(db, status=RunState.queued, created=NOW - timedelta(seconds=60), day=2)

    health = await generation.queue_health(SqlAlchemyGenerationQueue(db), now=NOW)

    assert health.queued == 2
    assert health.oldest_queued_seconds == 300.0


async def test_a_held_run_is_measured_by_its_heartbeat_not_by_its_age(db) -> None:
    """`stalest_running_seconds` answers „how close is this to being declared
    abandoned", so it reads `updated_at`, which the progress loop touches every
    second, and not `created_at`, which never moves."""
    await _run(
        db,
        status=RunState.running,
        created=NOW - timedelta(seconds=900),
        updated=NOW - timedelta(seconds=30),
        day=3,
    )

    health = await generation.queue_health(SqlAlchemyGenerationQueue(db), now=NOW)

    assert health.running == 1
    assert health.stalest_running_seconds == 30.0
    assert health.queued == 0


async def test_a_finished_run_is_no_longer_the_queue_s_problem(db) -> None:
    await _run(db, status=RunState.completed, created=NOW - timedelta(days=7), day=4)
    await _run(db, status=RunState.failed, created=NOW - timedelta(days=7), day=5)

    health = await generation.queue_health(SqlAlchemyGenerationQueue(db), now=NOW)

    assert (health.queued, health.running) == (0, 0)
    assert health.oldest_queued_seconds == 0.0


# ---------------------------------------------------------------- the outbox


async def _message(db, *, status, attempts: int, created: datetime, due: datetime) -> None:
    db.add(
        NotificationOutbox(
            channel="email",
            recipient="anna@example.com",
            subject="Temat",
            body="Treść",
            status=status,
            attempts=attempts,
            created_at=created,
            next_attempt_at=due,
        )
    )
    await db.commit()


async def test_the_outbox_age_counts_what_a_drain_would_take_right_now(db) -> None:
    await _message(
        db,
        status=NotificationStatus.pending,
        attempts=0,
        created=NOW - timedelta(seconds=120),
        due=NOW - timedelta(seconds=10),
    )
    await _message(
        db,
        status=NotificationStatus.pending,
        attempts=3,
        created=NOW - timedelta(seconds=90),
        due=NOW - timedelta(seconds=5),
    )

    health = await outbox_health(db, now=NOW)

    assert health.eligible == 2
    assert health.oldest_eligible_seconds == 120.0
    assert health.retrying == 1
    assert health.attempts_max == 3


async def test_a_disabled_channel_does_not_make_the_age_scream_for_ever(db) -> None:
    """A skipped row is parked a day out on purpose. Counted as overdue work it
    would pin the oldest-eligible age at a day and stay there, and the one
    number that says „the worker has stopped" would stop meaning anything.
    Counted nowhere it would vanish, so it is counted as waiting."""
    await _message(
        db,
        status=NotificationStatus.skipped,
        attempts=0,
        created=NOW - timedelta(seconds=40),
        due=NOW + timedelta(days=1),
    )
    await _message(
        db,
        status=NotificationStatus.pending,
        attempts=1,
        created=NOW - timedelta(seconds=30),
        due=NOW + timedelta(seconds=60),
    )

    health = await outbox_health(db, now=NOW)

    assert health.eligible == 0
    assert health.oldest_eligible_seconds == 0.0
    assert health.waiting == 2


async def test_messages_nobody_will_retry_are_counted_apart(db) -> None:
    await _message(
        db,
        status=NotificationStatus.failed,
        attempts=5,
        created=NOW - timedelta(seconds=500),
        due=NOW - timedelta(seconds=400),
    )
    await _message(
        db,
        status=NotificationStatus.sent,
        attempts=1,
        created=NOW - timedelta(seconds=600),
        due=NOW - timedelta(seconds=600),
    )

    health = await outbox_health(db, now=NOW)

    assert health.dead == 1
    assert (health.eligible, health.waiting) == (0, 0)


# -------------------------------------------------------------- the sampling


async def test_one_sample_reports_both_queues(db, caplog) -> None:
    await _run(db, status=RunState.queued, created=NOW - timedelta(seconds=45), day=6)
    await _message(
        db,
        status=NotificationStatus.pending,
        attempts=0,
        created=NOW - timedelta(seconds=20),
        due=NOW - timedelta(seconds=20),
    )

    await sample_metrics(db, now=NOW)

    assert _only(caplog, "queue")["oldest_queued_seconds"] == "45.0"
    assert _only(caplog, "outbox")["oldest_eligible_seconds"] == "20.0"


async def test_the_sample_speaks_before_its_first_sleep(db_factory, monkeypatch, caplog) -> None:
    """A heartbeat is only a liveness signal if it starts immediately: a worker
    that reported nothing for the first interval would be indistinguishable
    from one that never came up."""
    monkeypatch.setattr(get_settings(), "metrics_interval_seconds", 3600.0)
    from oncall.worker import _metrics_loop

    loop = asyncio.create_task(_metrics_loop(db_factory))
    for _ in range(100):
        await asyncio.sleep(0.01)
        if _records(caplog, "queue"):
            break
    loop.cancel()
    # Awaited, not merely cancelled: a task still unwinding after the fixture
    # has disposed the engine is how a suite grows its first flake.
    await asyncio.gather(loop, return_exceptions=True)

    assert _records(caplog, "queue"), "nothing was reported within the first interval"


# ---------------------------------------------------------- what a run costs


async def _queue_a_run(db, user_id, *, waited: timedelta = timedelta(0)) -> ScheduleRun:
    run = ScheduleRun(
        starts_on=date(2027, 7, 1),
        ends_on=date(2027, 7, 14),
        requested_by_id=user_id,
        status=RunState.queued,
        progress=0,
        created_at=datetime.now(UTC) - waited,
    )
    db.add(run)
    await db.commit()
    return run


def _generates(monkeypatch, outcome) -> None:
    """Stand in for the solver: either a stored draft or a chosen failure."""

    async def fake_generate(_request, _user, session, progress=None):
        if isinstance(outcome, BaseException):
            raise outcome
        return await staged_draft(session, starts_on=date(2027, 7, 1))

    monkeypatch.setattr("oncall.worker.generate_draft", fake_generate)


async def test_a_finished_run_reports_the_wait_and_the_work_apart(
    db, db_factory, monkeypatch, caplog
) -> None:
    """Two different complaints - „it sat in the queue" and „it took for ever"
    - need two different numbers, and a metric that added them together would
    answer neither."""
    _generates(monkeypatch, None)
    user = await create_user(db, "koord.m", role=UserRole.coordinator)
    await _queue_a_run(db, user.id, waited=timedelta(minutes=5))

    assert await generation_cycle(db_factory) == 1

    fields = _only(caplog, "generation")
    assert fields["outcome"] == RunOutcome.completed
    assert 300.0 <= float(fields["queued_seconds"]) < 360.0
    assert float(fields["run_seconds"]) < 60.0


@pytest.mark.parametrize(
    ("failure", "outcome"),
    [
        (GenerationFailed("brak obsady", ()), RunOutcome.infeasible),
        (ValueError("dzielenie przez zero"), RunOutcome.error),
    ],
)
async def test_a_failure_is_reported_as_the_kind_of_failure_it_is(
    db, db_factory, monkeypatch, caplog, failure, outcome
) -> None:
    """The two are told apart because the answers differ: an infeasible run
    means the roster and the hard rules disagree and somebody must change the
    inputs, while anything else is a defect in this code."""
    _generates(monkeypatch, failure)
    user = await create_user(db, "koord.m", role=UserRole.coordinator)
    run = await _queue_a_run(db, user.id)

    assert await generation_cycle(db_factory) == 1

    assert _only(caplog, "generation")["outcome"] == outcome
    async with db_factory() as reader:
        assert (await reader.get(ScheduleRun, run.id)).status == RunState.failed


async def test_a_run_whose_requester_is_gone_says_so(db, db_factory, monkeypatch, caplog) -> None:
    await _queue_a_run(db, None)

    assert await generation_cycle(db_factory) == 1

    assert _only(caplog, "generation")["outcome"] == RunOutcome.requester_missing


async def test_a_lane_that_lost_its_run_reports_the_solve_it_threw_away(
    db, db_factory, monkeypatch, caplog
) -> None:
    """The expensive failure: the solve finished and the terminal write was
    refused, because somebody else had already declared the run abandoned. It
    cannot be seen in the row - that says `failed`, like any other failure - so
    it can only be seen here."""
    user = await create_user(db, "koord.m", role=UserRole.coordinator)
    run = await _queue_a_run(db, user.id)

    async def steal_then_generate(_request, _user, session, progress=None):
        async with db_factory() as thief:
            await thief.execute(
                update(ScheduleRun)
                .where(ScheduleRun.id == run.id)
                .values(status=RunState.failed, progress=100, error="porzucone")
                .execution_options(synchronize_session=False)
            )
            await thief.commit()
        return await staged_draft(session, starts_on=date(2027, 7, 1))

    monkeypatch.setattr("oncall.worker.generate_draft", steal_then_generate)

    assert await generation_cycle(db_factory) == 1

    assert _only(caplog, "generation")["outcome"] == RunOutcome.reclaimed


async def test_reclaiming_a_dead_worker_s_run_is_reported_as_a_warning(
    db, db_factory, monkeypatch, caplog
) -> None:
    caplog.set_level(logging.WARNING, logger="oncall.metrics")
    monkeypatch.setattr(get_settings(), "stale_run_seconds", 120.0)
    await _run(
        db,
        status=RunState.running,
        created=datetime.now(UTC) - timedelta(minutes=30),
        updated=datetime.now(UTC) - timedelta(minutes=10),
        day=7,
    )

    assert await recover_abandoned(db_factory) == 1

    assert _only(caplog, "generation_abandoned")["runs"] == "1"
    assert caplog.records[-1].levelno == logging.WARNING


async def test_the_worker_actually_starts_the_loop_that_reports(monkeypatch) -> None:
    """Pins the wiring, not the loop.

    Every other test here calls `sample_metrics` or `_metrics_loop` by hand, so
    all of them stay green if the live worker never starts it - and a metric
    nobody emits is worse than none, because the silence looks like the system
    being quiet.
    """
    started: list[str] = []
    factories: set[object] = set()

    def records(name: str):
        async def loop(factory) -> None:
            started.append(name)
            factories.add(factory)

        return loop

    for name in ("_notification_loop", "_metrics_loop", "_generation_loop"):
        monkeypatch.setattr(f"oncall.worker.{name}", records(name))
    monkeypatch.setattr(get_settings(), "generation_concurrency", 2)
    factory = object()

    await worker_main(factory)

    assert started.count("_metrics_loop") == 1
    assert started.count("_notification_loop") == 1
    assert started.count("_generation_loop") == 2, "one lane per configured lane"
    assert factories == {factory}, "every loop works on the factory the process started with"


async def test_a_quiet_queue_still_reports_a_run_that_did_nothing_wrong(
    db, db_factory, monkeypatch, caplog
) -> None:
    """An empty queue produces no `generation` record at all - there is nothing
    to measure - but the sampled records keep coming, which is what separates
    „nothing to do" from „nobody is doing it"."""

    assert await generation_cycle(db_factory) == 0
    await sample_metrics(db, now=NOW)

    assert _records(caplog, "generation") == []
    assert _only(caplog, "queue")["queued"] == "0"
