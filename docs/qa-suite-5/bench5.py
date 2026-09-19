"""Round 5 solver benchmark.

Runs the production `generate_schedule` unmodified against the real database
inputs, captures the CP-SAT statistics of the pass that produced the answer,
and scores the draft on the same fairness metric the coordinator sees under the
draft matrix (`routes/scheduling.draft_fairness_impact`).
"""
import asyncio
import json
import sys
import time
from datetime import date, timedelta

from ortools.sat.python import cp_model
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from oncall.database import SessionFactory
from oncall.fairness import EligibilityPeriod, FairnessDuty, FairnessMemberInput, compute_fairness
from oncall.fairness_data import history_window, resolved_duties, solver_history
from oncall.models import AssignmentRole, LateShiftAnchor, RotationMode, TeamMember
from oncall.scheduler import DateRange, PreferenceRange, SolverMember, generate_schedule
from oncall.workdays import polish_holidays

LENSES = ("primary", "secondary", "late_shift", "weekends", "holidays")
PASSES: list[dict] = []
_original_solve = cp_model.CpSolver.solve


def _capturing_solve(self, model, *args, **kwargs):
    status = _original_solve(self, model, *args, **kwargs)
    PASSES.append({
        "status": self.status_name(status),
        "objective": self.objective_value,
        "bound": self.best_objective_bound,
        "cpsat_conflicts": self.num_conflicts,
        "branches": self.num_branches,
        "wall": round(self.wall_time, 2),
    })
    return status


cp_model.CpSolver.solve = _capturing_solve


async def load(starts_on: date, ends_on: date):
    async with SessionFactory() as db:
        orm = (
            (await db.scalars(select(TeamMember).options(
                selectinload(TeamMember.eligibility), selectinload(TeamMember.availability)
            ))).unique().all()
        )
        solver_members = [
            SolverMember(
                name=m.display_name, active=DateRange(m.active_from, m.active_until),
                eligibility={r: tuple(DateRange(e.starts_on, e.ends_on)
                                      for e in m.eligibility if e.role == r) for r in AssignmentRole},
                preferences=tuple(PreferenceRange(a.starts_on, a.ends_on, a.kind)
                                  for a in m.availability),
            ) for m in orm
        ]
        fairness_members = [
            FairnessMemberInput(
                id=m.id, display_name=m.display_name, active_from=m.active_from,
                active_until=m.active_until,
                eligibility={r: [EligibilityPeriod(e.starts_on, e.ends_on)
                                 for e in m.eligibility if e.role == r] for r in AssignmentRole},
            ) for m in orm
        ]
        names = {m.id: m.display_name for m in orm}
        history = await solver_history(db, starts_on, names)
        baseline_end = starts_on - timedelta(days=1)
        baseline_start = baseline_end - timedelta(days=365)
        projected_start = ends_on - timedelta(days=365)
        input_start = min(baseline_start, projected_start)
        historical = await resolved_duties(db, input_start, baseline_end)
        return (solver_members, fairness_members, history, historical,
                (input_start, baseline_start, baseline_end, projected_start, ends_on))


def spread(computation) -> dict:
    return {
        lens: round(
            max(getattr(m, lens).deviation for m in computation.members)
            - min(getattr(m, lens).deviation for m in computation.members),
            2,
        )
        for lens in LENSES
    }


def main() -> None:
    cases = json.loads(sys.argv[1])
    keys: list[tuple[date, date]] = []
    for case in cases:
        starts_on = date.fromisoformat(case["start"])
        key = (starts_on, starts_on + timedelta(days=case["days"] - 1))
        if key not in keys:
            keys.append(key)

    async def load_all():
        return {key: await load(*key) for key in keys}

    cache = asyncio.run(load_all())
    for case in cases:
        starts_on = date.fromisoformat(case["start"])
        ends_on = starts_on + timedelta(days=case["days"] - 1)
        (solver_members, fairness_members, history, historical,
         (input_start, baseline_start, baseline_end, projected_start, projected_end)) = cache[
            (starts_on, ends_on)
        ]
        holidays = polish_holidays(history_window(starts_on)[0], ends_on)
        PASSES.clear()
        began = time.perf_counter()
        result = generate_schedule(
            starts_on=starts_on, ends_on=ends_on,
            mode=RotationMode(case.get("mode", "hybrid")), members=solver_members,
            historical_points=history.points, holidays=holidays,
            historical_lenses=history.lenses, history_window=history_window(starts_on),
            fairness_weight=case.get("fairness", 3.0),
            continuity_weight=case.get("continuity", 1.0),
            preference_weight=case.get("preference", 2.0),
            late_shift_anchor=LateShiftAnchor(case.get("anchor", "secondary")),
            solver_workers=case.get("workers"), solve_seconds=case.get("seconds", 90.0),
        )
        elapsed = round(time.perf_counter() - began, 1)
        last = PASSES[-1] if PASSES else {}
        record = {
            **case, "status": result.status, "elapsed": elapsed,
            "passes": len(PASSES), **{k: v for k, v in last.items() if k != "status"},
            "warnings": len(result.warnings), "anchor_exceptions": len(result.anchor_exceptions),
            "failure": result.failure_reason,
        }
        if result.assignments:
            draft = [FairnessDuty(i.service_date, i.role, i.assignee_name)
                     for i in result.assignments]
            polish_days = polish_holidays(input_start, projected_end)
            before = compute_fairness(fairness_members, historical, holidays=polish_days,
                                      window_start=baseline_start, window_end=baseline_end)
            after = compute_fairness(fairness_members, historical + draft, holidays=polish_days,
                                     window_start=projected_start, window_end=projected_end)
            record["przed"] = spread(before)
            record["po"] = spread(after)
            record["max_po"] = max(record["po"].values())
        else:
            record["conflicts"] = list(result.conflicts)[:2]
        print(json.dumps(record, ensure_ascii=False), flush=True)


main()
