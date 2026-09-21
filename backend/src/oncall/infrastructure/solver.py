"""The generator's CP-SAT model behind the domain's `Solver` port."""

import anyio

from oncall.config import get_settings
from oncall.domain.scheduling.solver import ProgressCallback, SolveProblem, SolverResult
from oncall.scheduler import generate_schedule


class CpSatSolver:
    async def solve(self, problem: SolveProblem, progress: ProgressCallback | None) -> SolverResult:
        # CP-SAT is synchronous and CPU-bound. Running it in the event-loop used
        # to freeze health checks and every other request for up to 30 seconds.
        return await anyio.to_thread.run_sync(
            lambda: generate_schedule(
                starts_on=problem.starts_on,
                ends_on=problem.ends_on,
                mode=problem.mode,
                members=problem.members,
                historical_points=problem.historical_points,
                prior_oncall=problem.prior_oncall,
                holidays=problem.holidays,
                historical_lenses=problem.historical_lenses,
                history_window=problem.history_window,
                fairness_weight=problem.fairness_weight,
                continuity_weight=problem.continuity_weight,
                preference_weight=problem.preference_weight,
                late_shift_anchor=problem.late_shift_anchor,
                solver_workers=get_settings().solver_workers,
                solve_seconds=problem.solve_seconds,
                log_search_progress=get_settings().solver_log,
                progress_callback=progress,
            ),
            abandon_on_cancel=True,
        )
