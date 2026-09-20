"""QA7: solver optimality trace. Runs INSIDE the worker container.

Usage: python bench_trace.py START END BUDGET [MODE] [WORKERS] [--variant NAME]

Builds solver input exactly like `routes.scheduling.generate_draft`, then runs
`scheduler.generate_schedule` with `cp_model.CpSolver` replaced by a tracing
subclass. Every improving solution logs (wall, objective, best bound); every
pass logs its final status, objective, bound and relative gap. Nothing is
written to the database.

Variants (experiments, monkeypatched, never shipped):
  base            production model
  hint_greedy     replace the round-robin hint with the pass-1 solution of a
                  short warm-up solve (measures how much the hint matters)
  params_lin2     linearization_level=2 (stronger LP relaxation)
  params_sym      symmetry_level=4
  params_nolp     no LP workers weight: optimize_with_core + lb_tree_search in portfolio
"""
import asyncio
import json
import sys
import time
from datetime import date

from ortools.sat.python import cp_model

from oncall import scheduler
from oncall.config import get_settings
from oncall.database import SessionFactory
from oncall.fairness_data import generator_history_window, history_window, solver_history
from oncall.models import AssignmentRole, TeamMember
from oncall.policy import load_policy
from oncall.scheduler import DateRange, PreferenceRange, SolverMember, generate_schedule
from oncall.workdays import polish_holidays
from sqlalchemy import select
from sqlalchemy.orm import selectinload

args = [a for a in sys.argv[1:] if not a.startswith("--")]
START, END = date.fromisoformat(args[0]), date.fromisoformat(args[1])
BUDGET = float(args[2])
MODE = args[3] if len(args) > 3 else None
WORKERS = int(args[4]) if len(args) > 4 else None
VARIANT = sys.argv[sys.argv.index("--variant") + 1] if "--variant" in sys.argv else "base"

TRACE = []
PASSES = []
_orig = cp_model.CpSolver


class Tracing(_orig):
    def solve(self, model, solution_callback=None):
        if VARIANT == "params_lin2":
            self.parameters.linearization_level = 2
        if VARIANT == "params_sym":
            self.parameters.symmetry_level = 4
        if VARIANT == "probe_first" and abs(self.parameters.max_time_in_seconds - scheduler.FLOOR_PROBE_SECONDS) < 1e-6 or (VARIANT == "probe_first" and getattr(self, "_probe", False)):
            self.parameters.stop_after_first_solution = True
        if VARIANT == "params_core":
            self.parameters.optimize_with_core = True
        import inspect
        if VARIANT in ("probe_first", "nohist") and any(f.function == "cap_feasible" for f in inspect.stack()):
            self.parameters.stop_after_first_solution = True
        passno = len(PASSES)
        t0 = time.monotonic()
        points = []

        class CB(cp_model.CpSolverSolutionCallback):
            def on_solution_callback(self):
                points.append((round(time.monotonic() - t0, 2), self.ObjectiveValue(), self.BestObjectiveBound()))

        status = super().solve(model, CB())
        obj = self.objective_value if status in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None
        bound = self.best_objective_bound
        gap = (obj - bound) / abs(obj) if obj else None
        PASSES.append({
            "pass": passno, "budget": round(self.parameters.max_time_in_seconds, 1),
            "workers": self.parameters.num_workers, "status": self.status_name(status),
            "wall": round(time.monotonic() - t0, 2), "objective": obj, "bound": bound,
            "gap": round(gap, 4) if gap is not None else None, "solutions": len(points),
            "first": points[0] if points else None, "last_improvement": points[-1] if points else None,
            "trace": points[-12:],
        })
        return status


cp_model.CpSolver = Tracing


async def inputs():
    async with SessionFactory() as db:
        policy = await load_policy(db)
        orm = (await db.scalars(select(TeamMember).options(
            selectinload(TeamMember.eligibility), selectinload(TeamMember.availability)))).unique().all()
        members = [SolverMember(
            name=m.display_name, active=DateRange(m.active_from, m.active_until),
            eligibility={r: tuple(DateRange(e.starts_on, e.ends_on) for e in m.eligibility if e.role == r) for r in AssignmentRole},
            preferences=tuple(PreferenceRange(a.starts_on, a.ends_on, a.kind) for a in m.availability),
        ) for m in orm]
        names = {m.id: m.display_name for m in orm}
        ws, we = generator_history_window(START, END)
        hist = await solver_history(db, ws, we, names)
        hol = polish_holidays(history_window(START)[0], END)
        return policy, members, hist, (ws, we), hol


policy, members, hist, window, hol = asyncio.run(inputs())
mode = scheduler.RotationMode(MODE) if MODE else policy.rotation_mode
t = time.monotonic()
res = generate_schedule(
    starts_on=START, ends_on=END, mode=mode, members=members,
    historical_points={} if VARIANT == "nohist" else hist.points, holidays=hol,
    historical_lenses={} if VARIANT == "nohist" else hist.lenses, history_window=window,
    fairness_weight=policy.fairness_weight, continuity_weight=policy.continuity_weight,
    preference_weight=policy.preference_weight, late_shift_anchor=policy.late_shift_anchor,
    solver_workers=WORKERS or get_settings().solver_workers, solve_seconds=BUDGET,
)
print(json.dumps({
    "variant": VARIANT, "range": [str(START), str(END)], "days": (END - START).days + 1, "mode": mode.value,
    "budget": BUDGET, "workers": WORKERS or get_settings().solver_workers, "wall": round(time.monotonic() - t, 1),
    "status": res.status, "floor": res.acceptance_floor, "warnings": list(res.warnings), "passes": PASSES,
}, ensure_ascii=False))
