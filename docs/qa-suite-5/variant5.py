"""Three candidate solver changes, measured on the product's own fairness metric.

`okno`    - feed the generator the history that will still be inside the rolling
            window when the horizon closes, instead of the window anchored at the
            horizon start (the mismatch documented in window_check.py).
`limit`   - compile PLAN par. 3's acceptance criterion as a hard constraint on
            each lens range instead of leaving it entirely to the objective.
`tie`     - degrade the 11-19 lens to a tie-breaker when anchored (decision D1):
            drop its range term and price its spread terms at
            `max(1, round(fairness_cost * tie))`; `0` removes it from the
            objective entirely, the reference point for the measurement.
"""
import asyncio
import importlib.util
import json
import sys
import time
import types
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from oncall.database import SessionFactory
from oncall.effective import effective_assignments
from oncall.fairness import (
    ONCALL_ROLES, EligibilityPeriod, FairnessDuty, FairnessMemberInput,
    compute_fairness, day_weight,
)
from oncall.fairness_data import SolverHistory, history_window, resolved_duties
from oncall.models import AssignmentRole, LateShiftAnchor, RotationMode, TeamMember
from oncall.scheduler import DateRange, PreferenceRange, SolverMember
from oncall.workdays import polish_holidays

LENSES = ("primary", "secondary", "late_shift", "weekends", "holidays")
GRADED = ("primary", "secondary", "weekends", "holidays")
SOURCE = importlib.util.find_spec("oncall.scheduler").origin
BASE = open(SOURCE, encoding="utf-8").read()
NEEDLE = "        fairness_terms.append(maximum - minimum)"
TIE_RANGE_NEEDLE = """    for lens in lenses:
        maximum = model.new_int_var(lens.lower_bound, lens.upper_bound, f"max_{lens.label}")
        minimum = model.new_int_var(lens.lower_bound, lens.upper_bound, f"min_{lens.label}")
        for deviation in lens.deviations:
            model.add(maximum >= deviation)
            model.add(minimum <= deviation)
        # The range is used raw: at its maximum it contributes one `span` per
        # lens, the same order as every normalized spread term below.
        fairness_terms.append(maximum - minimum)"""
TIE_RANGE_REPLACEMENT = """    tie_break_terms: list[cp_model.LinearExpr] = []
    for lens in lenses:
        graded = not (
            lens.label == "late_shift"
            and late_shift_anchor != LateShiftAnchor.independent
        )
        if graded:
            maximum = model.new_int_var(lens.lower_bound, lens.upper_bound, f"max_{lens.label}")
            minimum = model.new_int_var(lens.lower_bound, lens.upper_bound, f"min_{lens.label}")
            for deviation in lens.deviations:
                model.add(maximum >= deviation)
                model.add(minimum <= deviation)
            fairness_terms.append(maximum - minimum)"""
TIE_SPREAD_NEEDLE = "            fairness_terms.append(spread)"
TIE_SPREAD_REPLACEMENT = (
    "            (fairness_terms if graded else tie_break_terms).append(spread)"
)
TIE_OBJECTIVE_NEEDLE = (
    "    objective = [term * fairness_cost for term in fairness_terms]"
)
MODULES: dict[tuple[int, float | None], object] = {}


def build(cap_points: int, tie_fraction: float | None = None):
    """Scheduler module with optional hard cap and 11-19 tie-breaker patches."""
    key = (cap_points, tie_fraction)
    if key in MODULES:
        return MODULES[key]
    assert not (cap_points and tie_fraction is not None), (
        "latki limit i tie nachodza na siebie; mierz osobno"
    )
    source = BASE
    if cap_points:
        assert NEEDLE in source, "nie znaleziono miejsca na ograniczenie rozpietosci"
        source = source.replace(
            NEEDLE,
            NEEDLE + f"\n        model.add(maximum - minimum <= {cap_points} * SCALE)",
        )
    if tie_fraction is not None:
        assert TIE_RANGE_NEEDLE in source, "nie znaleziono petli celu nad soczewkami"
        assert TIE_SPREAD_NEEDLE in source, "nie znaleziono zapisu czlonu rozkladu"
        assert TIE_OBJECTIVE_NEEDLE in source, "nie znaleziono zlozenia funkcji celu"
        source = source.replace(TIE_RANGE_NEEDLE, TIE_RANGE_REPLACEMENT)
        source = source.replace(TIE_SPREAD_NEEDLE, TIE_SPREAD_REPLACEMENT)
        source = source.replace(
            TIE_OBJECTIVE_NEEDLE,
            f"    tie_break_cost = 0 if not {tie_fraction!r} else max(1, round(fairness_cost * {tie_fraction!r}))\n"
            + TIE_OBJECTIVE_NEEDLE
            + "\n    objective.extend(term * tie_break_cost for term in tie_break_terms)",
        )
    module = types.ModuleType(f"scheduler_cap_{cap_points}_tie_{tie_fraction}")
    module.__file__ = SOURCE
    exec(compile(source, SOURCE, "exec"), module.__dict__)
    MODULES[key] = module
    return module


def spread(c):
    return {l: round(max(getattr(m, l).deviation for m in c.members)
                     - min(getattr(m, l).deviation for m in c.members), 2) for l in LENSES}


async def history_over(db, window_start, window_end, names_by_id) -> SolverHistory:
    holidays = polish_holidays(window_start, window_end)
    resolved = await effective_assignments(db, window_start, window_end)
    points: dict[tuple[str, AssignmentRole], float] = defaultdict(float)
    lenses: dict[tuple[str, str], float] = defaultdict(float)
    for item in resolved.values():
        name = names_by_id.get(item.member_id) if item.member_id is not None else None
        name = name or item.assignee_name
        if item.role in ONCALL_ROLES:
            points[(name, item.role)] += day_weight(item.service_date, holidays)
            if item.service_date.weekday() >= 5:
                lenses[(name, "weekends")] += 1.0
            elif item.service_date in holidays:
                lenses[(name, "holidays")] += 1.0
        else:
            points[(name, item.role)] += 1.0
    return SolverHistory(points=dict(points), lenses=dict(lenses))


async def main() -> None:
    for case in json.loads(sys.argv[1]):
        starts_on = date.fromisoformat(case["start"])
        ends_on = starts_on + timedelta(days=case["days"] - 1)
        async with SessionFactory() as db:
            orm = ((await db.scalars(select(TeamMember).options(
                selectinload(TeamMember.eligibility), selectinload(TeamMember.availability)
            ))).unique().all())
            solver_members = [SolverMember(
                name=m.display_name, active=DateRange(m.active_from, m.active_until),
                eligibility={r: tuple(DateRange(e.starts_on, e.ends_on)
                                      for e in m.eligibility if e.role == r) for r in AssignmentRole},
                preferences=tuple(PreferenceRange(a.starts_on, a.ends_on, a.kind)
                                  for a in m.availability)) for m in orm]
            fairness_members = [FairnessMemberInput(
                id=m.id, display_name=m.display_name, active_from=m.active_from,
                active_until=m.active_until,
                eligibility={r: [EligibilityPeriod(e.starts_on, e.ends_on)
                                 for e in m.eligibility if e.role == r]
                             for r in AssignmentRole}) for m in orm]
            names = {m.id: m.display_name for m in orm}
            anchored_start, anchored_end = history_window(starts_on)
            solver_start = (ends_on - timedelta(days=365)
                            if case.get("okno", "kroczace") == "kroczace" else anchored_start)
            history = await history_over(db, solver_start, anchored_end, names)
            historical = await resolved_duties(db, anchored_start, anchored_end)
        holidays = polish_holidays(anchored_start, ends_on)
        module = build(case.get("limit", 0), case.get("tie"))
        began = time.perf_counter()
        result = module.generate_schedule(
            starts_on=starts_on, ends_on=ends_on, mode=RotationMode(case.get("mode", "hybrid")),
            members=solver_members, historical_points=history.points, holidays=holidays,
            historical_lenses=history.lenses, history_window=(solver_start, anchored_end),
            fairness_weight=case.get("fairness", 3.0),
            continuity_weight=case.get("continuity", 1.0),
            preference_weight=case.get("preference", 2.0),
            late_shift_anchor=LateShiftAnchor(case.get("anchor", "secondary")),
            solver_workers=case.get("workers"), solve_seconds=case.get("seconds", 90.0),
        )
        elapsed = round(time.perf_counter() - began, 1)
        out = {**case, "status": result.status, "elapsed": elapsed}
        if result.assignments:
            draft = [FairnessDuty(i.service_date, i.role, i.assignee_name)
                     for i in result.assignments]
            days = polish_holidays(anchored_start, ends_on)
            report = compute_fairness(fairness_members, historical + draft, holidays=days,
                                      window_start=ends_on - timedelta(days=365), window_end=ends_on)
            out["po_raport"] = spread(report)
            out["max_po_raport"] = max(out["po_raport"].values())
            out["max_oceniane"] = max(out["po_raport"][lens] for lens in GRADED)
        else:
            out["conflicts"] = list(result.conflicts)[:2]
            out["failure"] = result.failure_reason
        print(json.dumps(out, ensure_ascii=False), flush=True)


asyncio.run(main())
