"""Run the solver with source-level variants of the model, to locate what costs time."""
import asyncio
import importlib.util
import json
import os
import sys
import time
import types
from datetime import date, timedelta

from ortools.sat.python import cp_model
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from oncall.database import SessionFactory
from oncall.fairness_data import history_window, solver_history
from oncall.models import AssignmentRole, LateShiftAnchor, RotationMode, TeamMember
from oncall.scheduler import DateRange, PreferenceRange, SolverMember
from oncall.workdays import polish_holidays

SOURCE = importlib.util.find_spec("oncall.scheduler").origin
BASE = open(SOURCE, encoding="utf-8").read()

VARIANTS = {
    "baseline": [],
    "fixed_bound": [
        ("model.add_assumption(spacing_enabled)", "model.add(spacing_enabled == 1)"),
        # The fairness family carries one span-scaled range term plus one squared term
        # per person, so its raw maximum is quadratic in the span. Bounding it by the
        # sum of spans made the normalised unit cost hundreds of times too large.
        (
            "        fairness_bound += lens.span",
            "        fairness_bound += lens.span * lens.span * (len(lens.deviations) + 1)",
        ),
    ],
    "fixed_bound_only": [
        (
            "        fairness_bound += lens.span",
            "        fairness_bound += lens.span * lens.span * (len(lens.deviations) + 1)",
        ),
    ],
    "probe_costs": [
        (
            "    objective = [term * fairness_cost for term in fairness_terms]",
            "    print('LENSES', [(l.label, l.span, l.lower_bound, l.upper_bound) for l in lenses])\n"
            "    print('BOUNDS fairness', fairness_bound, 'preference', preference_bound,"
            " 'continuity', continuity_bound, 'weekly_spacing', weekly_spacing_bound)\n"
            "    print('COSTS fairness', fairness_cost, 'preference', preference_cost,"
            " 'continuity', continuity_cost, 'weekly', weekly_spacing_cost)\n"
            "    print('TERM COUNTS fairness', len(fairness_terms), 'preference',"
            " len(preference_terms), 'continuity', len(continuity_terms))\n"
            "    print('MAX FAMILY CONTRIBUTION fairness',"
            " sum((l.span * l.span + l.span * l.span) for l in lenses) * fairness_cost,"
            " 'preference', preference_bound * preference_cost,"
            " 'continuity', continuity_bound * continuity_cost)\n"
            "    objective = [term * fairness_cost for term in fairness_terms]",
        ),
    ],
    "no_assumption": [
        ("model.add_assumption(spacing_enabled)", "model.add(spacing_enabled == 1)"),
    ],
    "no_assumption_scale1": [
        ("model.add_assumption(spacing_enabled)", "model.add(spacing_enabled == 1)"),
        ("    scale = 10", "    scale = 1"),
    ],
    "no_assumption_no_square": [
        ("model.add_assumption(spacing_enabled)", "model.add(spacing_enabled == 1)"),
        ("            fairness_terms.append(squared)", "            pass"),
    ],
    "no_assumption_scale1_fewer_tangents": [
        ("model.add_assumption(spacing_enabled)", "model.add(spacing_enabled == 1)"),
        ("    scale = 10", "    scale = 1"),
        ("min(16, lens.span)", "min(8, lens.span)"),
        ("[:15]", "[:7]"),
    ],
    "no_assumption_linear_abs": [
        ("model.add_assumption(spacing_enabled)", "model.add(spacing_enabled == 1)"),
        # add_abs_equality builds a kLinMax constraint per transition. The objective
        # already pushes the variable down, so two inequalities are enough and the
        # LP relaxation stays tight.
        (
            "                    model.add_abs_equality(transition, previous - current)",
            "                    model.add(transition >= previous - current)\n"
            "                    model.add(transition >= current - previous)",
        ),
    ],
    "no_assumption_linear_abs_scale1": [
        ("model.add_assumption(spacing_enabled)", "model.add(spacing_enabled == 1)"),
        (
            "                    model.add_abs_equality(transition, previous - current)",
            "                    model.add(transition >= previous - current)\n"
            "                    model.add(transition >= current - previous)",
        ),
        ("    scale = 10", "    scale = 1"),
    ],
}

CAPTURED: dict[str, float] = {}
_original_solve = cp_model.CpSolver.solve


def _capturing_solve(self, model, *args, **kwargs):
    status = _original_solve(self, model, *args, **kwargs)
    CAPTURED["objective"] = self.objective_value
    CAPTURED["bound"] = self.best_objective_bound
    CAPTURED["wall"] = self.wall_time
    return status


cp_model.CpSolver.solve = _capturing_solve


def build(name: str):
    source = BASE
    for needle, replacement in VARIANTS[name]:
        if needle not in source:
            raise SystemExit(f"variant {name}: pattern not found: {needle}")
        source = source.replace(needle, replacement)
    module = types.ModuleType(f"variant_{name}")
    module.__file__ = SOURCE
    exec(compile(source, SOURCE, "exec"), module.__dict__)
    return module


async def load(starts_on: date, ends_on: date):
    async with SessionFactory() as db:
        orm_members = (
            (await db.scalars(select(TeamMember).options(
                selectinload(TeamMember.eligibility), selectinload(TeamMember.availability)
            ))).unique().all()
        )
        members = [
            SolverMember(
                name=member.display_name,
                active=DateRange(member.active_from, member.active_until),
                eligibility={
                    role: tuple(DateRange(item.starts_on, item.ends_on)
                                for item in member.eligibility if item.role == role)
                    for role in AssignmentRole
                },
                preferences=tuple(PreferenceRange(item.starts_on, item.ends_on, item.kind)
                                  for item in member.availability),
            )
            for member in orm_members
        ]
        names = {member.id: member.display_name for member in orm_members}
        history = await solver_history(db, starts_on, names)
        return members, history, polish_holidays(history_window(starts_on)[0], ends_on)


def measure(result, holidays, history) -> dict:
    """Per-lens spread of the produced horizon, plus how preferences were treated."""
    from collections import defaultdict

    points = defaultdict(float)
    lenses = defaultdict(float)
    for item in result.assignments:
        day = item.service_date
        heavy = day.weekday() >= 5 or day in holidays
        if item.role == AssignmentRole.late_shift:
            lenses[("late_shift", item.assignee_name)] += 1
            continue
        points[(item.role.value, item.assignee_name)] += 2 if heavy else 1
        if day.weekday() >= 5:
            lenses[("weekends", item.assignee_name)] += 1
        elif day in holidays:
            lenses[("holidays", item.assignee_name)] += 1

    def spread(mapping, key):
        values = [value for (label, _name), value in mapping.items() if label == key]
        return round(max(values) - min(values), 2) if values else 0.0

    return {
        "spread_primary": spread(points, "primary"),
        "spread_secondary": spread(points, "secondary"),
        "spread_weekends": spread(lenses, "weekends"),
        "spread_late_shift": spread(lenses, "late_shift"),
    }


def main() -> None:
    cases = json.loads(sys.argv[1])
    keys = []
    for case in cases:
        starts_on = date.fromisoformat(case["start"])
        key = (starts_on, starts_on + timedelta(days=case["days"] - 1))
        if key not in keys:
            keys.append(key)

    async def load_all():
        return {key: await load(*key) for key in keys}

    cache = asyncio.run(load_all())
    modules: dict[str, object] = {}
    for case in cases:
        name = case.get("variant", "baseline")
        if name not in modules:
            modules[name] = build(name)
        module = modules[name]
        starts_on = date.fromisoformat(case["start"])
        ends_on = starts_on + timedelta(days=case["days"] - 1)
        members, history, holidays = cache[(starts_on, ends_on)]
        CAPTURED.clear()
        began = time.perf_counter()
        result = module.generate_schedule(
            starts_on=starts_on, ends_on=ends_on,
            mode=RotationMode(case.get("mode", "hybrid")), members=members,
            historical_points=history.points, holidays=holidays,
            historical_lenses=history.lenses, history_window=history_window(starts_on),
            fairness_weight=case.get("fairness", 3.0),
            continuity_weight=case.get("continuity", 1.0),
            preference_weight=case.get("preference", 2.0),
            late_shift_anchor=LateShiftAnchor(case.get("anchor", "secondary")),
            solver_workers=case.get("workers"), solve_seconds=case.get("seconds", 30.0),
            log_search_progress=case.get("log", False),
        )
        quality = measure(result, holidays, history)
        objective, bound = CAPTURED.get("objective"), CAPTURED.get("bound")
        gap = abs(objective - bound) / abs(objective) if objective else None
        print(json.dumps({
            **case, "status": result.status, "elapsed": round(time.perf_counter() - began, 2),
            "objective": objective, "bound": bound,
            "gap": round(gap, 5) if gap is not None else None,
            "assignments": len(result.assignments),
            "anchor_exceptions": len(result.anchor_exceptions), **quality,
            "warnings": list(result.warnings), "failure": result.failure_reason,
        }, ensure_ascii=False), flush=True)


main()
