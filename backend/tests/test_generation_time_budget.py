"""HGH6-02: one generation has a hard wall-clock ceiling.

`solve_seconds` is the budget of a single `solver.solve` call, but a generation
runs several passes in sequence - the criterion pass, the spacing / cap
fallbacks, then the bisection that reports the achievable floor. Before this,
nothing bounded their number, so a 15 s budget meant an 80 s wait and a 120 s
budget a 225 s one. Now `generate_schedule` tracks a deadline and hands every
pass only the time left.
"""

import re
import time
from datetime import date

import pytest
from ortools.sat.python import cp_model

from oncall.domain.scheduling.solver import GENERATION_BUDGET_PASSES, DateRange
from oncall.domain.vocabulary import AssignmentRole, RotationMode, UserRole
from oncall.scheduler import SolverMember, generate_schedule, total_time_budget
from tests.conftest import create_user, login


def _member(name: str) -> SolverMember:
    active = DateRange(date(2026, 1, 1), None)
    return SolverMember(
        name=name,
        active=active,
        eligibility={role: (active,) for role in AssignmentRole},
        preferences=(),
    )


#: The scripted solver hands back a roster with no duties in it, so it is a
#: debt carried in from history that puts the 12-month window over the
#: criterion and makes the floor question arise at all.
DEBT = {("Osoba 0", AssignmentRole.primary): 60.0}


def test_total_budget_is_the_per_pass_budget_times_the_pass_count() -> None:
    assert total_time_budget(15) == 15 * GENERATION_BUDGET_PASSES
    assert total_time_budget(30) == 30 * GENERATION_BUDGET_PASSES


@pytest.mark.anyio
async def test_policy_exposes_the_whole_run_ceiling(client, db) -> None:
    await create_user(db, "koord.budget", role=UserRole.coordinator)
    await login(client, "koord.budget")

    saved = await client.put(
        "/api/v1/scheduling/policy",
        json={"rotation_mode": "hybrid", "solve_seconds": 25},
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["solve_seconds"] == 25
    assert body["time_budget_seconds"] == 25 * GENERATION_BUDGET_PASSES


def test_the_pass_budgets_never_sum_past_the_ceiling(monkeypatch) -> None:
    """Worst mandatory path: every pass infeasible, so the criterion pass, the
    relaxed-spacing probe, the uncapped pass and the no-spacing fallback all
    run. Their budgets must sum to the ceiling, not `4 x solve_seconds` plus
    whatever the bisection would have added."""
    budgets: list[float] = []

    def recording_solve(self, model):
        budgets.append(self.parameters.max_time_in_seconds)
        return cp_model.INFEASIBLE

    monkeypatch.setattr(cp_model.CpSolver, "solve", recording_solve)

    result = generate_schedule(
        starts_on=date(2026, 9, 7),
        ends_on=date(2026, 9, 20),
        mode=RotationMode.hybrid,
        members=[_member(f"Osoba {index}") for index in range(6)],
        historical_points={},
        holidays=set(),
        solve_seconds=3.0,
    )

    assert result.status == "INFEASIBLE"
    assert budgets, "the solver was never called"
    assert max(budgets) <= 3.0 + 1e-6, budgets
    assert sum(budgets) <= total_time_budget(3.0) + 1e-6, budgets


def test_the_floor_bisection_yields_no_number_once_the_budget_is_spent(
    monkeypatch,
) -> None:
    """The achievable-floor warning states its number as fact, so a bisection
    that runs out of budget must return nothing rather than a starved guess."""
    script = [cp_model.INFEASIBLE, cp_model.INFEASIBLE, cp_model.FEASIBLE]

    def scripted_solve(self, model):
        budget = self.parameters.max_time_in_seconds
        time.sleep(min(budget, 1.0))
        return script.pop(0) if script else cp_model.INFEASIBLE

    monkeypatch.setattr(cp_model.CpSolver, "solve", scripted_solve)
    monkeypatch.setattr(cp_model.CpSolver, "boolean_value", lambda self, _v: False)
    monkeypatch.setattr(cp_model.CpSolver, "value", lambda self, _v: 0)

    started = time.monotonic()
    result = generate_schedule(
        starts_on=date(2026, 9, 7),
        ends_on=date(2026, 9, 20),
        mode=RotationMode.hybrid,
        members=[_member(f"Osoba {index}") for index in range(6)],
        historical_points=DEBT,
        holidays=set(),
        solve_seconds=0.8,
    )
    elapsed = time.monotonic() - started

    assert result.acceptance_floor is None
    assert any("nie udało się wyznaczyć" in warning for warning in result.warnings), result.warnings
    assert elapsed < total_time_budget(0.8) + 2.0, elapsed


def test_floor_probes_stop_after_the_first_feasible_solution(monkeypatch) -> None:
    stop_flags: list[bool] = []
    statuses = [
        cp_model.INFEASIBLE,
        cp_model.INFEASIBLE,
        cp_model.FEASIBLE,
        cp_model.FEASIBLE,
        cp_model.FEASIBLE,
        cp_model.FEASIBLE,
    ]

    def scripted_solve(self, model):
        stop_flags.append(self.parameters.stop_after_first_solution)
        return statuses.pop(0) if statuses else cp_model.FEASIBLE

    monkeypatch.setattr(cp_model.CpSolver, "solve", scripted_solve)
    monkeypatch.setattr(cp_model.CpSolver, "boolean_value", lambda self, _v: False)
    monkeypatch.setattr(cp_model.CpSolver, "value", lambda self, _v: 0)

    result = generate_schedule(
        starts_on=date(2026, 9, 7),
        ends_on=date(2026, 9, 20),
        mode=RotationMode.hybrid,
        members=[_member(f"Osoba {index}") for index in range(6)],
        historical_points=DEBT,
        holidays=set(),
        solve_seconds=5,
    )

    assert result.acceptance_floor is not None
    # Nothing but the lens arithmetic bounds the bisection from below, so the
    # floor lands where that bound says and not at a fixed probe ceiling.
    assert result.acceptance_floor > 10
    assert stop_flags[:3] == [False, False, False]
    assert stop_flags[3:]
    assert all(stop_flags[3:])


def test_a_pass_that_runs_out_of_time_retries_in_the_time_left(monkeypatch) -> None:
    """A starved solver that finds nothing within its pass budget is handed the
    rest of the run's ceiling before the run gives up (issue #179); stubbed
    statuses, because a really starved thread fails only some of the time."""
    budgets: list[float] = []
    script = [cp_model.UNKNOWN, cp_model.FEASIBLE]

    def scripted_solve(self, model):
        budgets.append(self.parameters.max_time_in_seconds)
        return script.pop(0)

    monkeypatch.setattr(cp_model.CpSolver, "solve", scripted_solve)
    monkeypatch.setattr(cp_model.CpSolver, "boolean_value", lambda self, _v: False)
    monkeypatch.setattr(cp_model.CpSolver, "value", lambda self, _v: 0)

    result = generate_schedule(
        starts_on=date(2026, 9, 7),
        ends_on=date(2026, 9, 20),
        mode=RotationMode.hybrid,
        members=[_member(f"Osoba {index}") for index in range(6)],
        historical_points={},
        holidays=set(),
        solve_seconds=3.0,
    )

    assert result.failure_reason is None
    assert result.status == "FEASIBLE"
    # The first pass had its own budget; the retry has what is left of the
    # ceiling, less the orchestration reserve.
    assert budgets[0] <= 3.0
    assert 3.0 < budgets[1] <= total_time_budget(3.0) - 3.0


def test_a_run_out_of_time_names_the_time_it_took(monkeypatch) -> None:
    budgets: list[float] = []

    def unknown_solve(self, model):
        budgets.append(self.parameters.max_time_in_seconds)
        return cp_model.UNKNOWN

    monkeypatch.setattr(cp_model.CpSolver, "solve", unknown_solve)

    started = time.monotonic()
    result = generate_schedule(
        starts_on=date(2026, 9, 7),
        ends_on=date(2026, 9, 20),
        mode=RotationMode.hybrid,
        members=[_member(f"Osoba {index}") for index in range(6)],
        historical_points={},
        holidays=set(),
        solve_seconds=3.0,
    )
    elapsed = time.monotonic() - started

    assert result.failure_reason == "UNKNOWN"
    assert len(budgets) == 2, budgets
    match = re.search(r"w (\d+,\d) s\.", result.conflicts[0])
    assert match is not None, result.conflicts[0]
    # The stubbed passes return at once, so the run took a fraction of a
    # second, not the 12 s ceiling the message used to quote.
    assert float(match.group(1).replace(",", ".")) <= round(elapsed, 1)
    assert "12 s" not in result.conflicts[0]
