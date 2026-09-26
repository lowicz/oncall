"""Background worker: notification outbox drain, handover reminders, and
schedule generation.

Runs as a separate process (``python -m oncall.worker``). The process runs
independent loops in one event loop:

* the **notification loop** drains a batch of pending outbox rows through the
  registered channel providers and, after the configured hour in
  Europe/Warsaw, enqueues reminders about today's PRIMARY handover;
* one or more **generation lanes** claim queued ``ScheduleRun`` rows with
  ``SELECT ... FOR UPDATE SKIP LOCKED`` and solve them;
* the **metrics loop** samples how much work is waiting in each and reports it
  through ``oncall.metrics``, which is also where a finished run says what it
  cost and why it ended;
* the **retention loop** deletes, once an hour and in bounded batches, the
  rows past their configured age (``oncall.retention``), and reports what it
  removed through the same channel.

The loops are independent so a generation that takes a minute no longer holds
back a swap notification behind it. The solve itself runs in
a worker thread, so the notification loop keeps its rhythm while a lane is
busy. Reminders are deduplicated per date and schedule, so the scan can repeat
safely within the day.

Every database step opens exactly one `SqlAlchemyUnitOfWork` on the session
factory the process was started with, and that unit of work is the only thing
here that commits or rolls back. A generation is five named steps: recover,
claim, solve-and-store, heartbeat (once a second while the solve lives) and
finish.
"""

import asyncio
import logging
import time
import uuid
from asyncio import Task
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

import oncall.infrastructure.sqlalchemy.model_registry  # noqa: F401  # registers every mapper
from oncall.config import get_settings
from oncall.database import SessionFactory, SqlAlchemyUnitOfWork
from oncall.domain.clock import as_utc, utc_now
from oncall.domain.handover import remind_of_handover
from oncall.domain.scheduling import generation
from oncall.domain.scheduling.errors import GenerationFailed
from oncall.domain.scheduling.models import GenerationRequest, GenerationRun, RunOutcome
from oncall.domain.scheduling.ports import StoredSchedule
from oncall.domain.scheduling.solver import ProgressCallback
from oncall.domain.team import Actor
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.infrastructure.sqlalchemy.handover import handover_ports
from oncall.infrastructure.sqlalchemy.scheduling import generation_ports
from oncall.infrastructure.sqlalchemy.scheduling_generation import (
    SqlAlchemyGenerationQueue,
    SqlAlchemyRunClaims,
)
from oncall.metrics import emit
from oncall.notifications.email import default_providers
from oncall.notifications.service import drain_outbox, outbox_health
from oncall.retention import RetentionPolicy, RetentionReport, prune_expired
from oncall.scheduler import MODEL_BUILT, SOLVE_DONE, SOLVE_PASS

logger = logging.getLogger(__name__)

WARSAW = ZoneInfo("Europe/Warsaw")

#: A worker's database: every step opens its unit of work on this factory.
Sessions = async_sessionmaker[AsyncSession]

#: What a run whose requester was deleted reads when it ends.
REQUESTER_MISSING_ERROR = "Konto zlecające już nie istnieje"


def _generation_failure(exc: Exception) -> tuple[str, list[str] | None]:
    """Return a readable summary and the solver's structured conflict list."""
    detail = (
        {"message": exc.message, "reason": exc.reason, "conflicts": exc.conflicts}
        if isinstance(exc, GenerationFailed)
        else getattr(exc, "detail", exc)
    )
    if not isinstance(detail, dict):
        return str(detail)[:500], None
    message = str(detail.get("message", "Generator zakończył się błędem"))
    reason = detail.get("reason")
    raw_conflicts = detail.get("conflicts")
    conflicts = (
        [str(item) for item in raw_conflicts] if isinstance(raw_conflicts, (list, tuple)) else None
    )
    parts = [message]
    if reason:
        parts.append(f"Powód: {reason}")
    return " | ".join(parts)[:500], conflicts


def _generation_error(exc: Exception) -> str:
    """Backward-compatible summary helper used by focused unit tests."""
    message, conflicts = _generation_failure(exc)
    return " | ".join([message, *(conflicts or [])])[:500]


async def generate_draft(
    request: GenerationRequest,
    user: User,
    db: AsyncSession,
    progress: ProgressCallback | None = None,
) -> StoredSchedule:
    """Generate one draft and stage it on `db`; the caller's unit of work
    writes it."""
    return await generation.generate_draft(request, generation_ports(db, user), progress)


async def scan_handover(db: AsyncSession, *, now_warsaw: datetime) -> int:
    """Enqueue today's PRIMARY handover reminders; returns the number enqueued."""
    return await remind_of_handover(
        now_warsaw, get_settings().handover_reminder_hour, handover_ports(db)
    )


async def notification_cycle(factory: Sessions) -> dict[str, int]:
    """One outbox drain plus one handover scan.

    Runs on a fixed rhythm in the worker, independent of any generation in
    flight, so a notification enqueued mid-generation is delivered within two
    of these cycles rather than waiting out the solve. The drain owns its own
    units of work (see `drain_outbox`); the scan is one more.
    """
    settings = get_settings()
    stats = await drain_outbox(
        factory,
        default_providers(settings),
        batch_size=settings.worker_batch_size,
        max_attempts=settings.notification_max_attempts,
        lease=timedelta(seconds=settings.notification_lease_seconds),
    )
    async with SqlAlchemyUnitOfWork(factory) as db:
        stats["handover"] = await scan_handover(db, now_warsaw=utc_now().astimezone(WARSAW))
    return stats


async def recover_abandoned(factory: Sessions) -> int:
    """The recover step: free the ranges held by runs whose worker died
    mid-solve.

    Runs before every claim rather than only at start-up: a lane killed while
    its siblings keep working leaves a stuck row that no restart would ever
    see. On an idle lane this is one indexed statement a second that matches
    nothing, which is cheaper than the bookkeeping a throttle would need.
    """
    async with SqlAlchemyUnitOfWork(factory) as db:
        reclaimed = await generation.recover_abandoned_runs(
            SqlAlchemyGenerationQueue(db),
            stale_after=get_settings().stale_run_seconds,
            now=utc_now(),
        )
    if reclaimed:
        # A measurement rather than a sentence, at the severity the sentence
        # had: a run only reaches here because a worker died holding it.
        emit("generation_abandoned", level=logging.WARNING, runs=reclaimed)
    return reclaimed


async def generation_cycle(factory: Sessions) -> int:
    """Reclaim what died, then claim and run one queued generation.

    Every step opens a session of its own, so two lanes - or a lane's solve and
    its progress bar - never share an ``AsyncSession``. Returns 1 if a run was
    processed, 0 if the queue was empty.
    """
    await recover_abandoned(factory)
    return await process_schedule_run(factory)


#: Where the bar stands once a lane has taken the run and before the solver
#: has said anything. Not zero, because the coordinator is watching and
#: something has in fact happened.
CLAIMED_PROGRESS = 10

#: The solve occupies this span of the progress bar. The search is most of
#: what a generation costs - on a 90 second budget, nearly all of it - so the
#: bar has to move during it rather than stand at the model-built mark.
MODEL_BUILT_PROGRESS = 30
SOLVE_DONE_PROGRESS = 90


def solve_progress(elapsed: float, announced: float) -> int:
    """Where the bar stands mid-search.

    Scaled to the budget of every pass announced so far, not to a single one:
    a run that has to prove the acceptance criterion unattainable solves
    several models in sequence, so a bar scaled to one budget would pin long
    before the end. Never returns the „solve finished" value - only the
    milestone itself may claim that.
    """
    if announced <= 0:
        return MODEL_BUILT_PROGRESS
    share = min(1.0, max(0.0, elapsed) / announced)
    span = SOLVE_DONE_PROGRESS - MODEL_BUILT_PROGRESS - 1
    return MODEL_BUILT_PROGRESS + int(span * share)


@dataclass
class _Bar:
    """Solver milestones in, a percentage out.

    Separate from the writing because it is the only part of the progress
    protocol with any arithmetic in it, and because a state machine that needs
    no database is a state machine that can be read.
    """

    #: Where the bar stands. Starts at whatever claiming the run wrote.
    progress: int
    #: When the solver said it had a model, by the monotonic clock.
    started_at: float | None = None
    #: Total budget of every pass announced so far.
    announced: float = 0.0
    #: How much of the milestone list has been consumed.
    read: int = 0

    def advance(self, milestones: list[str]) -> int:
        """Fold in whatever the solver has said since the last call.

        `milestones` is appended from the solver thread. Reading by index
        rather than re-scanning means a concurrent append can neither be missed
        nor counted twice.
        """
        while self.read < len(milestones):
            item = milestones[self.read]
            self.read += 1
            if item == MODEL_BUILT:
                self.started_at = time.monotonic()
                self.progress = max(self.progress, MODEL_BUILT_PROGRESS)
            elif item.startswith(f"{SOLVE_PASS} "):
                self.announced += float(item.split(" ", 1)[1])
            elif item == SOLVE_DONE:
                self.progress = SOLVE_DONE_PROGRESS
        if self.started_at is not None and self.progress < SOLVE_DONE_PROGRESS:
            # `max` keeps the bar from walking backwards when a further pass is
            # announced and the denominator grows.
            self.progress = max(
                self.progress,
                solve_progress(time.monotonic() - self.started_at, self.announced),
            )
        return self.progress


async def _claim_run(factory: Sessions) -> GenerationRun | None:
    """The claim step: take the oldest queued run for this lane alone.

    Committed before the solve starts, which releases the lock `SKIP LOCKED`
    took before anything slow happens - and which is what makes a killed
    worker leave a `running` row behind, see `recover_abandoned_runs`.
    """
    async with SqlAlchemyUnitOfWork(factory) as db:
        return await SqlAlchemyRunClaims(db).claim_oldest(progress=CLAIMED_PROGRESS)


class _RequesterMissing(Exception):
    """The account that asked for the run was deleted after it was claimed."""


async def _solve_and_store(
    factory: Sessions, run: GenerationRun, requester_id: uuid.UUID, progress: ProgressCallback
) -> uuid.UUID | None:
    """The solve-and-store step: load the requester, solve, and store the
    draft, all in one unit of work.

    No row lock is held while the solver runs: the run's own row was released
    when the claim committed, and the generator takes none before it stores
    the draft. Anything that fails in here - after the draft was staged
    included - rolls all of it back, so a failed run leaves no half of a draft.
    """
    async with SqlAlchemyUnitOfWork(factory) as db:
        user = await db.get(User, requester_id)
        if user is None:
            raise _RequesterMissing
        stored = await generate_draft(
            GenerationRequest(
                actor=Actor(user.id, user.display_name, user.role),
                starts_on=run.starts_on,
                ends_on=run.ends_on,
            ),
            user,
            db,
            progress=progress,
        )
    return stored.id


async def _heartbeat(factory: Sessions, run_id: uuid.UUID, progress: int) -> None:
    """The heartbeat step: touch the held run with where its bar stands."""
    async with SqlAlchemyUnitOfWork(factory) as db:
        await SqlAlchemyRunClaims(db).heartbeat(run_id, progress)


async def _report_progress(
    factory: Sessions,
    run_id: uuid.UUID,
    milestones: list[str],
    solving: Task[Any],
    *,
    start: int,
) -> None:
    """Keep the run's row current until the solve finishes.

    Every pass is a heartbeat step on a session of its own, never a write
    through the session the generation is using. An `AsyncSession` must not
    be used by two concurrent tasks. Writing through the generation's session
    from here smuggles an autoflushed UPDATE into whatever transaction it has
    open, which takes a lock on this very row inside a transaction whose
    lifetime this loop does not control - and holds it until that transaction
    ends, however long the solve runs.

    Every pass writes, not only the passes where the bar moves: the touch is
    also this run's heartbeat, and `recover_abandoned_runs` reads `updated_at`
    to tell a live solve from a worker that died holding the row. The bar
    stands still for minutes at a time - before the model is built, and again
    while the draft is being stored.
    """
    bar = _Bar(progress=start)
    while not solving.done():
        await asyncio.sleep(1)
        # Folded once per pass, and named before the statement so it stays
        # that way: calling `advance` twice would consume the milestone list
        # twice and double the announced budget.
        progress = bar.advance(milestones)
        await _heartbeat(factory, run_id, progress)


@dataclass(frozen=True)
class _Ending:
    """How a run ends: the outcome an operator reads, and what the terminal
    write records for the coordinator."""

    outcome: RunOutcome
    schedule_id: uuid.UUID | None = None
    error: str = ""
    conflicts: list[str] | None = None


async def _finish_run(factory: Sessions, run_id: uuid.UUID, ending: _Ending) -> bool:
    """The finish step: write the run's terminal state, but only while this
    lane still holds it.

    A lane that stalls past `stale_run_seconds` has its run declared abandoned
    and failed by somebody else; if it then wakes up and finishes, writing
    `completed` over that would resurrect a run the coordinator has already
    been told about and may have replaced by hand. Every transition here is
    compare-and-set on `running`, so the late writer loses instead, and this
    answers False so the caller can say so.
    """
    async with SqlAlchemyUnitOfWork(factory) as db:
        claims = SqlAlchemyRunClaims(db)
        if ending.outcome is RunOutcome.completed:
            held = await claims.complete(run_id, ending.schedule_id)
        elif ending.outcome is RunOutcome.requester_missing:
            held = await claims.fail_unstarted(run_id, ending.error)
        else:
            held = await claims.fail(run_id, ending.error, ending.conflicts)
    if not held:
        logger.warning("Generation run %s was reclaimed before it finished", run_id)
    return held


async def _generate(factory: Sessions, run: GenerationRun) -> _Ending:
    """Solve and store the run's draft while its bar reports, and say how it
    ended."""
    # The column is `ON DELETE SET NULL`, so a deleted requester leaves no id
    # to look up rather than an id that finds nothing.
    if run.requested_by_id is None:
        return _Ending(RunOutcome.requester_missing, error=REQUESTER_MISSING_ERROR)
    try:
        # Real milestones from the solver turn the progress bar from a
        # spinner into an actual signal.
        milestones: list[str] = []
        solving = asyncio.create_task(
            _solve_and_store(factory, run, run.requested_by_id, milestones.append)
        )
        await _report_progress(factory, run.id, milestones, solving, start=run.progress)
        schedule_id = await solving
    except _RequesterMissing:
        # Deleted after the claim, while this lane already held the run.
        return _Ending(RunOutcome.requester_missing, error=REQUESTER_MISSING_ERROR)
    except Exception as exc:  # noqa: BLE001 - failure is returned to polling client
        message, conflicts = _generation_failure(exc)
        outcome = RunOutcome.infeasible if isinstance(exc, GenerationFailed) else RunOutcome.error
        return _Ending(outcome, error=message, conflicts=conflicts)
    return _Ending(RunOutcome.completed, schedule_id=schedule_id)


async def process_schedule_run(factory: Sessions) -> int:
    """Take one queued run through to a draft, or to a readable failure.

    Claim, solve-and-store, heartbeat and finish are separate steps with one
    unit of work each: the claim commits before the solve starts, the
    heartbeats commit while it runs, and the finish writes the terminal state
    if this lane still holds the run. Returns 1 if a run was processed, 0 if
    the queue was empty.

    Every path leaves through the same finish and the same measurement, so a
    run is recorded once and cannot end without saying what it cost or why it
    ended. `queued_seconds` is the coordinator's wait, taken from the row;
    `run_seconds` is this lane's own work on it, taken from the monotonic clock
    because a wall clock can step sideways mid-solve.
    """
    run = await _claim_run(factory)
    if run is None:
        return 0
    taken_at = time.monotonic()
    waited = max(0.0, (utc_now() - as_utc(run.created_at)).total_seconds())
    ending = await _generate(factory, run)
    held = await _finish_run(factory, run.id, ending)
    emit(
        "generation",
        run=run.id,
        # A lane that no longer holds the run did the work and lost it, whatever
        # it was about to write.
        outcome=ending.outcome if held else RunOutcome.reclaimed,
        queued_seconds=waited,
        run_seconds=time.monotonic() - taken_at,
    )
    return 1


async def sample_metrics(db: AsyncSession, *, now: datetime) -> None:
    """Read what is waiting, in both queues, and say so.

    One sample rather than two, because the two questions an operator asks
    during an incident - „is the generator keeping up" and „are the e-mails
    going out" - are usually the same question, and a shared timestamp makes
    the two records comparable.
    """
    queue = await generation.queue_health(SqlAlchemyGenerationQueue(db), now=now)
    emit(
        "queue",
        queued=queue.queued,
        running=queue.running,
        oldest_queued_seconds=queue.oldest_queued_seconds,
        stalest_running_seconds=queue.stalest_running_seconds,
    )
    outbox = await outbox_health(db, now=now)
    emit(
        "outbox",
        eligible=outbox.eligible,
        oldest_eligible_seconds=outbox.oldest_eligible_seconds,
        retrying=outbox.retrying,
        attempts_max=outbox.attempts_max,
        waiting=outbox.waiting,
        dead=outbox.dead,
    )


async def _notification_loop(factory: Sessions) -> None:
    settings = get_settings()
    while True:
        try:
            stats = await notification_cycle(factory)
            if any(stats.values()):
                emit("notifications", **stats)
        except Exception:
            logger.exception("Notification cycle failed")
        await asyncio.sleep(settings.worker_poll_seconds)


async def _metrics_loop(factory: Sessions) -> None:
    """Sample both queues on a timer, starting immediately.

    A loop of its own rather than a few lines added to the notification cycle:
    the loops here are independent on purpose, and a sample that rode along
    with the drain would tie how often the numbers appear to how often
    notifications are attempted, and would change what `notification_cycle` returns.
    """
    settings = get_settings()
    while True:
        try:
            async with SqlAlchemyUnitOfWork(factory) as db:
                await sample_metrics(db, now=utc_now())
        except Exception:
            logger.exception("Metrics sample failed")
        await asyncio.sleep(settings.metrics_interval_seconds)


async def retention_cycle(factory: Sessions) -> RetentionReport:
    """One pass of the retention rules, measured.

    Reported every pass, whether or not anything was deleted: a pass that
    deletes nothing every hour is the sign that retention is running at all,
    and `capped` above zero is the sign that a table still has a backlog the
    next pass will go on with. The pass owns its units of work, one per
    batch (see `prune_expired`).
    """
    started = time.monotonic()
    report = await prune_expired(
        factory, RetentionPolicy.from_settings(get_settings()), now=utc_now()
    )
    emit("retention", **report.fields(), seconds=time.monotonic() - started)
    return report


async def _retention_loop(factory: Sessions) -> None:
    """Prune on a timer, starting immediately.

    A loop of its own like the others: a pass over a large backlog must not
    delay a notification or a metrics sample, and a pass that fails (the
    database away, a lock timeout) is logged and simply tried again next
    interval, since it left nothing half-done to repair.
    """
    settings = get_settings()
    while True:
        try:
            await retention_cycle(factory)
        except Exception:
            logger.exception("Retention cycle failed")
        await asyncio.sleep(settings.retention_interval_seconds)


async def _generation_loop(factory: Sessions) -> None:
    settings = get_settings()
    while True:
        processed = 0
        try:
            processed = await generation_cycle(factory)
        except Exception:
            logger.exception("Generation cycle failed")
        # A lane that just finished a run checks the queue again immediately;
        # an idle lane waits before the next poll.
        await asyncio.sleep(0 if processed else settings.generation_poll_seconds)


async def worker_main(factory: Sessions) -> None:
    settings = get_settings()
    logger.info(
        "Worker started (notifications every %.1f s, %d generation lane(s), "
        "retention every %.0f s)",
        settings.worker_poll_seconds,
        settings.generation_concurrency,
        settings.retention_interval_seconds,
    )
    async with asyncio.TaskGroup() as group:
        group.create_task(_notification_loop(factory))
        group.create_task(_metrics_loop(factory))
        group.create_task(_retention_loop(factory))
        for _ in range(settings.generation_concurrency):
            group.create_task(_generation_loop(factory))


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    asyncio.run(worker_main(SessionFactory))
