"""Queueing and executing schedule generation."""

import uuid
from datetime import date, datetime, timedelta

from oncall.domain.ports import PublishedRoster
from oncall.domain.scheduling import errors
from oncall.domain.scheduling.models import (
    ACTIVE_RUN_STATES,
    ROTATION_NAME_LABELS,
    GenerationRequest,
    GenerationRun,
    QueuedGeneration,
    QueueHealth,
    RunState,
    RunView,
)
from oncall.domain.scheduling.ports import (
    GenerationPorts,
    GenerationQueue,
    GenerationRequestPorts,
    NewDraft,
    QueueMonitor,
    RunRecovery,
    StoredSchedule,
)
from oncall.domain.scheduling.solver import (
    DateRange,
    PreferenceRange,
    ProgressCallback,
    SolveProblem,
    SolverMember,
    total_time_budget,
)
from oncall.domain.team import Member
from oncall.domain.vocabulary import AssignmentRole
from oncall.fairness import generator_history_window, history_window
from oncall.workdays import polish_holidays


async def uncovered_dates(starts_on: date, roster: PublishedRoster, today: date) -> list[date]:
    """Days between today and the horizon that no duty in force covers."""
    if starts_on <= today:
        return []
    end = starts_on - timedelta(days=1)
    effective = await roster.duties_in_force(today, end)
    return [
        day
        for offset in range((end - today).days + 1)
        if (
            (day := today + timedelta(days=offset), AssignmentRole.primary) not in effective
            or (day, AssignmentRole.secondary) not in effective
        )
    ]


async def _recent_run_seconds(queue: GenerationQueue, fallback: float) -> float:
    """Mean wall-clock duration of the last few finished generations."""
    rows = await queue.recent_completed(5)
    spans = [
        (run.updated_at - run.created_at).total_seconds()
        for run in rows
        if run.updated_at is not None and run.created_at is not None
    ]
    spans = [span for span in spans if span > 0]
    return sum(spans) / len(spans) if spans else total_time_budget(fallback)


async def view_run(
    run: GenerationRun, solve_seconds: float, queue: GenerationQueue, *, lanes: int
) -> RunView:
    """Describe a run and its position in the active generation queue."""
    if run.status != RunState.queued:
        return RunView(run, solve_seconds, 0 if run.status == RunState.running else None, None)
    ahead = await queue.active_runs_before(run.created_at) or 0
    lanes = max(1, lanes)
    slots_ahead = ahead // lanes
    if slots_ahead == 0:
        return RunView(run, solve_seconds, ahead, 0)
    per_run = await _recent_run_seconds(queue, solve_seconds)
    return RunView(run, solve_seconds, ahead, int(slots_ahead * per_run))


#: What the coordinator reads on a run nobody is solving any more. It names the
#: worker rather than the schedule, because nothing about their request was
#: wrong and re-queueing it is the whole remedy.
ABANDONED_RUN_ERROR = "Generowanie przerwane: proces roboczy przestał odpowiadać. Zleć je ponownie."


async def recover_abandoned_runs(queue: RunRecovery, *, stale_after: float, now: datetime) -> int:
    """Fail runs whose worker died mid-solve, and answer with how many.

    A run is claimed by setting it to `running`, which is committed before the
    solve begins, so a worker that is killed from then on leaves the row saying
    `running` for ever. That is not merely untidy: `running` is an active state,
    so `active_run_for` keeps handing the dead run back and the coordinator can
    never generate that range again, while the client polls a bar that will
    never move.

    Liveness is read from `updated_at`, which the worker's progress loop touches
    once a second for as long as the generation lives. A healthy solve therefore
    stays fresh however long it runs, and the cutoff bounds the gap between
    heartbeats rather than the length of the solve.
    """
    return await queue.abandon_stale_runs(now - timedelta(seconds=stale_after), ABANDONED_RUN_ERROR)


async def queue_health(queue: QueueMonitor, *, now: datetime) -> QueueHealth:
    """What the queue looks like from outside: how deep, and how long a wait.

    The ages are computed here rather than in the adapter so the moment they
    are measured against is the caller's, and so the arithmetic is testable
    without a database.
    """
    backlog = await queue.backlog()
    return QueueHealth(
        queued=backlog.queued,
        running=backlog.running,
        oldest_queued_seconds=_age(backlog.oldest_queued_at, now),
        stalest_running_seconds=_age(backlog.stalest_running_at, now),
    )


def _age(moment: datetime | None, now: datetime) -> float:
    """Seconds since `moment`; zero when there is nothing to measure.

    Nothing waiting reads as a zero age, which is only honest next to the count
    that says so - the two fields are always emitted together. The floor is
    there because timestamps are written by each worker's own clock: a lane
    running slightly ahead would otherwise report a negative wait.
    """
    if moment is None:
        return 0.0
    return max(0.0, (now - moment).total_seconds())


async def queue_generation(
    request: GenerationRequest, ports: GenerationRequestPorts, *, lanes: int, today: date
) -> QueuedGeneration:
    solve_seconds = (await ports.policy.current()).solve_seconds
    uncovered = tuple(await uncovered_dates(request.starts_on, ports.roster, today))
    # Returning an active run avoids indistinguishable drafts for the same range.
    # The partial unique index is the backstop for concurrent requests.
    run = await ports.queue.active_run_for(request.starts_on, request.ends_on)
    if run is None:
        run = await ports.queue.enqueue(request.starts_on, request.ends_on, request.actor.user_id)
    return QueuedGeneration(await view_run(run, solve_seconds, ports.queue, lanes=lanes), uncovered)


async def runs_in_flight(
    actor_id: uuid.UUID, status: str | None, ports: GenerationRequestPorts, *, lanes: int
) -> list[RunView]:
    wanted = [status] if status else [state.value for state in ACTIVE_RUN_STATES]
    runs = await ports.queue.runs_of(actor_id, wanted, 10)
    solve_seconds = (await ports.policy.current()).solve_seconds
    return [await view_run(run, solve_seconds, ports.queue, lanes=lanes) for run in runs]


async def generation_status(
    run_id: uuid.UUID, ports: GenerationRequestPorts, *, lanes: int
) -> RunView:
    run = await ports.queue.run(run_id)
    if run is None:
        raise errors.GenerationRunNotFound(run_id)
    solve_seconds = (await ports.policy.current()).solve_seconds
    return await view_run(run, solve_seconds, ports.queue, lanes=lanes)


_FAILURE_MESSAGES = {
    "PRECHECK": "Nie można zbudować kompletnego modelu grafiku",
    "INFEASIBLE": "Reguły twarde nie pozwalają utworzyć kompletnego grafiku",
    "UNKNOWN": "Solver wyczerpał budżet czasu bez kompletnego grafiku",
}


def _solver_member(member: Member) -> SolverMember:
    return SolverMember(
        name=member.display_name,
        active=DateRange(member.active_from, member.active_until),
        eligibility={
            role: tuple(
                DateRange(item.starts_on, item.ends_on)
                for item in member.eligibility
                if item.role == role
            )
            for role in AssignmentRole
        },
        preferences=tuple(
            PreferenceRange(item.starts_on, item.ends_on, item.kind) for item in member.availability
        ),
    )


async def generate_draft(
    request: GenerationRequest,
    ports: GenerationPorts,
    progress: ProgressCallback | None = None,
) -> StoredSchedule:
    """Build and store one draft. The worker owns the surrounding transaction."""
    policy = await ports.policy.current()
    members = await ports.members.everyone()
    member_names = {member.id: member.display_name for member in members}
    window_start, window_end = generator_history_window(request.starts_on, request.ends_on)
    points, lenses = await ports.history.points(window_start, window_end, member_names)
    prior_oncall = await ports.history.prior_oncall_days(request.starts_on, member_names)
    holidays = polish_holidays(history_window(request.starts_on)[0], request.ends_on)
    result = await ports.solver.solve(
        SolveProblem(
            starts_on=request.starts_on,
            ends_on=request.ends_on,
            mode=policy.rotation_mode,
            members=[_solver_member(member) for member in members],
            historical_points=points,
            prior_oncall=prior_oncall,
            holidays=holidays,
            historical_lenses=lenses,
            history_window=(window_start, window_end),
            fairness_weight=policy.fairness_weight,
            continuity_weight=policy.continuity_weight,
            preference_weight=policy.preference_weight,
            late_shift_anchor=policy.late_shift_anchor,
            solve_seconds=policy.solve_seconds,
        ),
        progress,
    )
    if result.conflicts:
        raise errors.GenerationFailed(
            _FAILURE_MESSAGES.get(
                result.failure_reason or "", "Nie można utworzyć kompletnego grafiku"
            ),
            result.failure_reason,
            result.conflicts,
        )
    member_ids = {name: member_id for member_id, name in member_names.items()}
    draft = NewDraft(
        name=(
            f"Szkic {ROTATION_NAME_LABELS[policy.rotation_mode]} "
            f"{request.starts_on:%d-%m-%Y} - {request.ends_on:%d-%m-%Y}"
        ),
        starts_on=request.starts_on,
        ends_on=request.ends_on,
        rotation_mode=policy.rotation_mode,
        result=result,
        assignments=tuple(
            (item, member_ids.get(item.assignee_name)) for item in result.assignments
        ),
    )
    stored = await ports.drafts.store_draft(draft)
    await ports.journal.draft_generated(stored, draft)
    return stored
