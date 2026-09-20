"""Measure CP-SAT status, wall time, objective and bound for a matrix of runs.

Loads exactly the inputs `routes/scheduling.generate_draft` builds, so the numbers
describe the production model and not a simplification of it.
"""
import asyncio
import json
import os
import sys
import time
from datetime import date, timedelta

from ortools.sat.python import cp_model
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from oncall.database import SessionFactory
from oncall.fairness_data import history_window, solver_history
from oncall.models import AssignmentRole, LateShiftAnchor, RotationMode, TeamMember
from oncall import scheduler as scheduler_module
from oncall.scheduler import DateRange, PreferenceRange, SolverMember, generate_schedule
from oncall.workdays import polish_holidays

CAPTURED: dict[str, float] = {}
CACHE: dict = {}
_original_solve = cp_model.CpSolver.solve


def _capturing_solve(self, model, *args, **kwargs):
    status = _original_solve(self, model, *args, **kwargs)
    try:
        CAPTURED["objective"] = self.objective_value
        CAPTURED["bound"] = self.best_objective_bound
        CAPTURED["conflicts"] = self.num_conflicts
        CAPTURED["branches"] = self.num_branches
        CAPTURED["wall"] = self.wall_time
    except Exception:
        pass
    return status


cp_model.CpSolver.solve = _capturing_solve

if os.environ.get("QA_NO_ASSUMPTIONS") == "1":
    # CP-SAT refuses multi-threaded search while a model carries assumptions.
    # Fixing the literal instead lets the same model use every worker.
    cp_model.CpModel.add_assumption = lambda self, literal: self.add(literal == 1)
    cp_model.CpModel.clear_assumptions = lambda self: None

if os.environ.get("QA_SCALE"):
    scheduler_module.__dict__.setdefault("_qa_scale", os.environ["QA_SCALE"])


async def load(starts_on: date, ends_on: date):
    async with SessionFactory() as db:
        orm_members = (
            (
                await db.scalars(
                    select(TeamMember).options(
                        selectinload(TeamMember.eligibility),
                        selectinload(TeamMember.availability),
                    )
                )
            )
            .unique()
            .all()
        )
        members = [
            SolverMember(
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
                    PreferenceRange(item.starts_on, item.ends_on, item.kind)
                    for item in member.availability
                ),
            )
            for member in orm_members
        ]
        names = {member.id: member.display_name for member in orm_members}
        history = await solver_history(db, starts_on, names)
        holidays = polish_holidays(history_window(starts_on)[0], ends_on)
        return members, history, holidays


def run(case: dict) -> dict:
    starts_on = date.fromisoformat(case["start"])
    ends_on = starts_on + timedelta(days=case["days"] - 1)
    members, history, holidays = CACHE[(starts_on, ends_on)]
    CAPTURED.clear()
    began = time.perf_counter()
    result = generate_schedule(
        starts_on=starts_on,
        ends_on=ends_on,
        mode=RotationMode(case.get("mode", "hybrid")),
        members=members,
        historical_points=history.points,
        holidays=holidays,
        historical_lenses=history.lenses,
        history_window=history_window(starts_on),
        fairness_weight=case.get("fairness", 3.0),
        continuity_weight=case.get("continuity", 1.0),
        preference_weight=case.get("preference", 2.0),
        late_shift_anchor=LateShiftAnchor(case.get("anchor", "secondary")),
        solver_workers=case.get("workers"),
        solve_seconds=case.get("seconds", 30.0),
        log_search_progress=case.get("log", False),
    )
    elapsed = time.perf_counter() - began
    objective = CAPTURED.get("objective")
    bound = CAPTURED.get("bound")
    gap = None
    if objective and bound is not None and objective != 0:
        gap = abs(objective - bound) / abs(objective)
    return {
        **case,
        "status": result.status,
        "elapsed": round(elapsed, 2),
        "objective": objective,
        "bound": bound,
        "gap": round(gap, 5) if gap is not None else None,
        "conflicts_cpsat": CAPTURED.get("conflicts"),
        "branches": CAPTURED.get("branches"),
        "assignments": len(result.assignments),
        "warnings": list(result.warnings),
        "anchor_exceptions": len(result.anchor_exceptions),
        "failure": result.failure_reason,
        "solver_conflicts": list(result.conflicts)[:2],
    }


async def load_all(keys):
    return {key: await load(*key) for key in keys}


if __name__ == "__main__":
    cases = json.loads(sys.argv[1])
    keys = []
    for case in cases:
        starts_on = date.fromisoformat(case["start"])
        key = (starts_on, starts_on + timedelta(days=case["days"] - 1))
        if key not in keys:
            keys.append(key)
    # One event loop for every load: the engine pool cannot cross loops.
    CACHE.update(asyncio.run(load_all(keys)))
    for case in cases:
        outcome = run(case)
        print(json.dumps(outcome, ensure_ascii=False), flush=True)
