"""Score solver variants on the product's own fairness metric.

Mirrors `routes/scheduling.draft_fairness_impact` exactly, so the numbers are
comparable with what a coordinator sees under the draft matrix.
"""
import asyncio
import importlib.util
import json
import sys
import time
import types
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from oncall.database import SessionFactory
from oncall.fairness import EligibilityPeriod, FairnessDuty, FairnessMemberInput, compute_fairness
from oncall.fairness_data import history_window, resolved_duties, solver_history
from oncall.models import AssignmentRole, LateShiftAnchor, RotationMode, TeamMember
from oncall.scheduler import DateRange, PreferenceRange, SolverMember
from oncall.workdays import polish_holidays

SOURCE = importlib.util.find_spec("oncall.scheduler").origin
BASE = open(SOURCE, encoding="utf-8").read()
LENSES = ("primary", "secondary", "late_shift", "weekends", "holidays")

VARIANTS = {
    "baseline": [],
    "no_assumption": [
        ("model.add_assumption(spacing_enabled)", "model.add(spacing_enabled == 1)"),
    ],
    "no_assumption_fixed_bound": [
        ("model.add_assumption(spacing_enabled)", "model.add(spacing_enabled == 1)"),
        (
            "        fairness_bound += lens.span",
            "        fairness_bound += lens.span * lens.span * (len(lens.deviations) + 1)",
        ),
    ],
    "no_assumption_late_lens": [
        ("model.add_assumption(spacing_enabled)", "model.add(spacing_enabled == 1)"),
        # Keep the 11-19 lens in the objective even when it is anchored.
        (
            "    fairness_roles = (\n        AssignmentRole\n        if late_shift_anchor == LateShiftAnchor.independent\n        else ONCALL_ROLES\n    )",
            "    fairness_roles = AssignmentRole",
        ),
    ],
    "no_assumption_late_lens_fixed_bound": [
        ("model.add_assumption(spacing_enabled)", "model.add(spacing_enabled == 1)"),
        (
            "    fairness_roles = (\n        AssignmentRole\n        if late_shift_anchor == LateShiftAnchor.independent\n        else ONCALL_ROLES\n    )",
            "    fairness_roles = AssignmentRole",
        ),
        (
            "        fairness_bound += lens.span",
            "        fairness_bound += lens.span * lens.span * (len(lens.deviations) + 1)",
        ),
    ],
}


def build(name: str):
    source = BASE
    for needle, replacement in VARIANTS[name]:
        if needle not in source:
            raise SystemExit(f"variant {name}: nie znaleziono wzorca")
        source = source.replace(needle, replacement)
    module = types.ModuleType(f"variant_{name}")
    module.__file__ = SOURCE
    exec(compile(source, SOURCE, "exec"), module.__dict__)
    return module


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
    result = {}
    for lens in LENSES:
        values = [getattr(member, lens).deviation for member in computation.members]
        result[lens] = round(max(values) - min(values), 2)
    return result


def main() -> None:
    cases = json.loads(sys.argv[1])
    cache, modules = {}, {}
    keys = []
    for case in cases:
        starts_on = date.fromisoformat(case["start"])
        key = (starts_on, starts_on + timedelta(days=case["days"] - 1))
        if key not in keys:
            keys.append(key)

    async def load_all():
        return {key: await load(*key) for key in keys}

    cache = asyncio.run(load_all())
    for case in cases:
        name = case.get("variant", "baseline")
        modules.setdefault(name, build(name))
        starts_on = date.fromisoformat(case["start"])
        ends_on = starts_on + timedelta(days=case["days"] - 1)
        (solver_members, fairness_members, history, historical,
         (input_start, baseline_start, baseline_end, projected_start, projected_end)) = cache[
            (starts_on, ends_on)
        ]
        holidays = polish_holidays(history_window(starts_on)[0], ends_on)
        began = time.perf_counter()
        result = modules[name].generate_schedule(
            starts_on=starts_on, ends_on=ends_on,
            mode=RotationMode(case.get("mode", "hybrid")), members=solver_members,
            historical_points=history.points, holidays=holidays,
            historical_lenses=history.lenses, history_window=history_window(starts_on),
            late_shift_anchor=LateShiftAnchor(case.get("anchor", "secondary")),
            solver_workers=case.get("workers"), solve_seconds=case.get("seconds", 30.0),
        )
        elapsed = time.perf_counter() - began
        if not result.assignments:
            print(json.dumps({**case, "status": result.status, "failure": result.failure_reason},
                             ensure_ascii=False), flush=True)
            continue
        draft = [FairnessDuty(item.service_date, item.role, item.assignee_name)
                 for item in result.assignments]
        polish_days = polish_holidays(input_start, projected_end)
        baseline = compute_fairness(fairness_members, historical, holidays=polish_days,
                                    window_start=baseline_start, window_end=baseline_end)
        projected = compute_fairness(fairness_members, historical + draft, holidays=polish_days,
                                     window_start=projected_start, window_end=projected_end)
        print(json.dumps({
            **case, "status": result.status, "elapsed": round(elapsed, 1),
            "przed": spread(baseline), "po": spread(projected),
        }, ensure_ascii=False), flush=True)


main()
