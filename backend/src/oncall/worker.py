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
  cost and why it ended.

The loops are independent so a generation that takes a minute no longer holds
back a swap notification behind it. The solve itself runs in
a worker thread, so the notification loop keeps its rhythm while a lane is
busy. Reminders are deduplicated per date and schedule, so the scan can repeat
safely within the day.
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

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from oncall.config import get_settings
from oncall.database import SessionFactory
from oncall.domain.clock import as_utc, utc_now
from oncall.domain.handover import remind_of_handover
from oncall.domain.scheduling import generation
from oncall.domain.scheduling.errors import GenerationFailed
from oncall.domain.scheduling.models import GenerationRequest, RunOutcome, RunState
from oncall.domain.scheduling.ports import StoredSchedule
from oncall.domain.scheduling.solver import ProgressCallback
from oncall.domain.team import Actor
from oncall.infrastructure.sqlalchemy.handover import handover_ports
from oncall.infrastructure.sqlalchemy.scheduling import scheduling_ports
from oncall.metrics import emit
from oncall.models import ScheduleRun, User
from oncall.notifications.email import default_providers
from oncall.notifications.service import drain_outbox, outbox_health
from oncall.scheduler import MODEL_BUILT, SOLVE_DONE, SOLVE_PASS

logger = logging.getLogger(__name__)

WARSAW = ZoneInfo("Europe/Warsaw")


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
    """Generate one draft and store it in its own unit of work."""
    stored = await generation.generate_draft(request, scheduling_ports(db, user), progress)
    await db.commit()
    return stored


async def scan_handover(db: AsyncSession, *, now_warsaw: datetime) -> int:
    """Enqueue today's PRIMARY handover reminders; returns the number enqueued."""
    return await remind_of_handover(
        now_warsaw, get_settings().handover_reminder_hour, handover_ports(db)
    )


async def notification_cycle() -> dict[str, int]:
    """One outbox drain plus one handover scan.

    Runs on a fixed rhythm in the worker, independent of any generation in
    flight, so a notification enqueued mid-generation is delivered within two
    of these cycles rather than waiting out the solve.
    """
    settings = get_settings()
    async with SessionFactory() as db:
        stats = await drain_outbox(
            db,
            default_providers(settings),
            batch_size=settings.worker_batch_size,
            max_attempts=settings.notification_max_attempts,
            lease=timedelta(seconds=settings.notification_lease_seconds),
        )
    async with SessionFactory() as db:
        stats["handover"] = await scan_handover(db, now_warsaw=utc_now().astimezone(WARSAW))
        await db.commit()
    return stats


async def recover_abandoned(db: AsyncSession) -> int:
    """Free the ranges held by runs whose worker died mid-solve.

    Runs before every claim rather than only at start-up: a lane killed while
    its siblings keep working leaves a stuck row that no restart would ever
    see. On an idle lane this is one indexed statement a second that matches
    nothing, which is cheaper than the bookkeeping a throttle would need.
    """
    reclaimed = await generation.recover_abandoned_runs(
        scheduling_ports(db).queue,
        stale_after=get_settings().stale_run_seconds,
        now=utc_now(),
    )
    await db.commit()
    if reclaimed:
        # A measurement rather than a sentence, at the severity the sentence
        # had: a run only reaches here because a worker died holding it.
        emit("generation_abandoned", level=logging.WARNING, runs=reclaimed)
    return reclaimed


async def generation_cycle() -> int:
    """Reclaim what died, then claim and run one queued generation.

    Each generation lane calls this on its own session so two lanes never share
    an ``AsyncSession``. Returns 1 if a run was processed, 0 if the queue was
    empty.
    """
    async with SessionFactory() as db:
        await recover_abandoned(db)
        return await process_schedule_run(db)


async def worker_cycle() -> dict[str, int]:
    """One notification cycle followed by one generation cycle.

    The live worker runs notifications and generation as separate loops
    (:func:`worker_main`); this wrapper keeps a single deterministic seam for
    tests and for ``archive/docs/qa-suite-6/load_worker.py``, whose acceptance is
    phrased in whole worker cycles.
    """
    stats = await notification_cycle()
    stats["schedule_runs"] = await generation_cycle()
    return stats


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


async def _claim_run(db: AsyncSession) -> ScheduleRun | None:
    """Take the oldest queued run for this lane alone, or answer None.

    ``SKIP LOCKED`` is what lets lanes run side by side: a lane never queues
    behind another lane's row, it moves on to the next one. The claim is
    committed before the solve starts, which is what makes a killed worker
    leave a `running` row behind - see `recover_abandoned_runs`.
    """
    run = await db.scalar(
        select(ScheduleRun)
        .where(ScheduleRun.status == RunState.queued)
        .order_by(ScheduleRun.created_at)
        .limit(1)
        .with_for_update(skip_locked=True)
    )
    if run is None:
        return None
    run.status = RunState.running
    run.progress = CLAIMED_PROGRESS
    await db.commit()
    return run


async def _report_progress(
    run_id: uuid.UUID, milestones: list[str], solving: Task[Any], *, start: int
) -> None:
    """Keep the run's row current until the solve finishes.

    Deliberately takes `run_id` and not the session the generation is using.
    An `AsyncSession` must not be used by two concurrent tasks. Writing
    through the generation's session from here smuggles an autoflushed UPDATE
    into whatever transaction it has open, which takes a lock on this very row
    inside a transaction whose lifetime this loop does not control - and holds
    it until that transaction ends, however long the solve runs.

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
        async with SessionFactory() as progress_db:
            await progress_db.execute(
                update(ScheduleRun)
                .where(ScheduleRun.id == run_id, ScheduleRun.status == RunState.running)
                .values(progress=progress)
            )
            await progress_db.commit()


async def _finish_run(db: AsyncSession, run_id: uuid.UUID, **values: object) -> bool:
    """Write a run's final state, but only while this worker still holds it.

    A lane that stalls past `stale_run_seconds` has its run declared abandoned
    and failed by somebody else; if it then wakes up and finishes, writing
    `completed` over that would resurrect a run the coordinator has already
    been told about and may have replaced by hand. The predicate makes the
    late writer lose instead, and it answers False so the caller can say so.
    """
    result = await db.execute(
        update(ScheduleRun)
        .where(ScheduleRun.id == run_id, ScheduleRun.status == RunState.running)
        .values(**values)
    )
    await db.commit()
    if result.rowcount != 1:
        logger.warning("Generation run %s was reclaimed before it finished", run_id)
    return result.rowcount == 1


async def process_schedule_run(db: AsyncSession) -> int:
    """Take one queued run through to a draft, or to a readable failure.

    Four steps with four owners: claiming picks the run and marks it held, the
    generation task solves it on this session, the progress reporter keeps the
    row current on sessions of its own, and finishing writes the terminal state
    if this lane still holds the run. Returns 1 if a run was processed, 0 if
    the queue was empty.

    Every path leaves through the same finish and the same measurement, so a
    run is recorded once and cannot end without saying what it cost or why it
    ended. `queued_seconds` is the coordinator's wait, taken from the row;
    `run_seconds` is this lane's own work on it, taken from the monotonic clock
    because a wall clock can step sideways mid-solve.
    """
    run = await _claim_run(db)
    if run is None:
        return 0
    run_id, start = run.id, run.progress
    taken_at = time.monotonic()
    waited = max(0.0, (utc_now() - as_utc(run.created_at)).total_seconds())
    # The column is `ON DELETE SET NULL`, so a deleted requester leaves no id
    # to look up rather than an id that finds nothing.
    user = await db.get(User, run.requested_by_id) if run.requested_by_id else None
    if user is None:
        outcome = RunOutcome.requester_missing
        values: dict[str, object] = {
            "status": RunState.failed,
            "progress": 100,
            "error": "Konto zlecające już nie istnieje",
        }
    else:
        try:
            # Real milestones from the solver turn the progress bar from a
            # spinner into an actual signal.
            milestones: list[str] = []
            solving = asyncio.create_task(
                generate_draft(
                    GenerationRequest(
                        actor=Actor(user.id, user.display_name, user.role),
                        starts_on=run.starts_on,
                        ends_on=run.ends_on,
                    ),
                    user,
                    db,
                    progress=milestones.append,
                )
            )
            await _report_progress(run_id, milestones, solving, start=start)
            result = await solving
        except Exception as exc:  # noqa: BLE001 - failure is returned to polling client
            message, conflicts = _generation_failure(exc)
            outcome = (
                RunOutcome.infeasible if isinstance(exc, GenerationFailed) else RunOutcome.error
            )
            values = {
                "status": RunState.failed,
                "progress": 100,
                "error": message,
                "conflicts": conflicts,
            }
        else:
            outcome = RunOutcome.completed
            values = {
                "status": RunState.completed,
                "progress": 100,
                "schedule_id": result.id,
            }
    held = await _finish_run(db, run_id, **values)
    emit(
        "generation",
        run=run_id,
        # A lane that no longer holds the run did the work and lost it, whatever
        # it was about to write.
        outcome=outcome if held else RunOutcome.reclaimed,
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
    queue = await generation.queue_health(scheduling_ports(db).queue, now=now)
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


async def _notification_loop() -> None:
    settings = get_settings()
    while True:
        try:
            stats = await notification_cycle()
            if any(stats.values()):
                emit("notifications", **stats)
        except Exception:
            logger.exception("Notification cycle failed")
        await asyncio.sleep(settings.worker_poll_seconds)


async def _metrics_loop() -> None:
    """Sample both queues on a timer, starting immediately.

    A loop of its own rather than a few lines added to the notification cycle:
    the loops here are independent on purpose, and a sample that rode along
    with the drain would tie how often the numbers appear to how often
    notifications are attempted, and would change what `worker_cycle` returns.
    """
    settings = get_settings()
    while True:
        try:
            async with SessionFactory() as db:
                await sample_metrics(db, now=utc_now())
        except Exception:
            logger.exception("Metrics sample failed")
        await asyncio.sleep(settings.metrics_interval_seconds)


async def _generation_loop() -> None:
    settings = get_settings()
    while True:
        processed = 0
        try:
            processed = await generation_cycle()
        except Exception:
            logger.exception("Generation cycle failed")
        # A lane that just finished a run checks the queue again immediately;
        # an idle lane waits before the next poll.
        await asyncio.sleep(0 if processed else settings.generation_poll_seconds)


async def worker_main() -> None:
    settings = get_settings()
    logger.info(
        "Worker started (notifications every %.1f s, %d generation lane(s))",
        settings.worker_poll_seconds,
        settings.generation_concurrency,
    )
    async with asyncio.TaskGroup() as group:
        group.create_task(_notification_loop())
        group.create_task(_metrics_loop())
        for _ in range(settings.generation_concurrency):
            group.create_task(_generation_loop())


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    asyncio.run(worker_main())
