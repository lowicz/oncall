"""QA7: solver pass-1 experiments. Runs INSIDE a container with the oncall package.

Usage: python bench_variants.py START END BUDGET WORKERS EXPERIMENT [EXPERIMENT...]

Every experiment builds the production pass-1 model (`_build_model` with the
3-point cap and spacing rules, the same inputs as `generate_draft`) and traces
(time, objective, bound). Objectives of different experiments are comparable
only when they use the same cost families; `full_*` experiments all report the
production objective.

  full           production model, production round-robin hint
  fair_only      continuity and preference families priced 0 - how fast is the
                 fairness part alone proven optimal?
  warm           fair_only for up to BUDGET/3, then the full model hinted with
                 that solution for the rest of BUDGET (total = BUDGET)
  lin2           full model, linearization_level=2
  nohint         full model with every hint removed
  fixed_search   full model, search_branching=FIXED_SEARCH + hint, 1 extra worker
"""
import asyncio
import json
import sys
import time
from datetime import date

from ortools.sat.python import cp_model
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from oncall import scheduler
from oncall.database import SessionFactory
from oncall.fairness_data import generator_history_window, history_window, solver_history
from oncall.models import AssignmentRole, TeamMember
from oncall.policy import load_policy
from oncall.scheduler import ACCEPTANCE_POINTS, DateRange, PreferenceRange, SolverMember
from oncall.workdays import polish_holidays

START, END = date.fromisoformat(sys.argv[1]), date.fromisoformat(sys.argv[2])
BUDGET, WORKERS = float(sys.argv[3]), int(sys.argv[4])
EXPERIMENTS = sys.argv[5:]


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


CAPTURED = {}
_orig_new_int_var = cp_model.CpModel.new_int_var


def _capturing_new_int_var(self, lb, ub, name):
    var = _orig_new_int_var(self, lb, ub, name)
    for prefix in ("max_", "min_", "spread_", "transition_", "second_duty_"):
        if name.startswith(prefix):
            CAPTURED.setdefault(id(self), {}).setdefault(prefix, []).append(var)
            CAPTURED.setdefault(id(self), {}).setdefault("by_name", {})[name] = var
    return var


cp_model.CpModel.new_int_var = _capturing_new_int_var


def fairness_units(model):
    c = CAPTURED[id(model)]
    return sum(c.get("max_", [])) - sum(c.get("min_", [])) + sum(c.get("spread_", []))


def breakdown(solver, model):
    c = CAPTURED[id(model)]
    return {
        "fairness_units": solver.value(fairness_units(model)),
        "transitions": sum(solver.value(v) for v in c.get("transition_", [])),
        "second_duties": sum(solver.value(v) for v in c.get("second_duty_", [])),
    }


def build(fair_only=False):
    orig = scheduler.marginal_cost
    if fair_only:
        scheduler.marginal_cost = lambda w, s: orig(w, s) if s == scheduler.FAIRNESS_STEP else 0
    try:
        return scheduler._build_model(
            starts_on=START, ends_on=END, mode=policy.rotation_mode, members=members,
            historical_points=hist.points, holidays=hol, historical_lenses=hist.lenses,
            history_window=window, fairness_weight=policy.fairness_weight,
            continuity_weight=policy.continuity_weight, preference_weight=policy.preference_weight,
            late_shift_anchor=policy.late_shift_anchor, spacing=True, acceptance_cap=ACCEPTANCE_POINTS,
        )
    finally:
        scheduler.marginal_cost = orig


def solve(model, seconds, **params):
    s = cp_model.CpSolver()
    s.parameters.max_time_in_seconds = seconds
    s.parameters.num_workers = WORKERS
    for k, v in params.items():
        setattr(s.parameters, k, v)
    pts = []
    t0 = time.monotonic()

    class CB(cp_model.CpSolverSolutionCallback):
        def on_solution_callback(self):
            pts.append((round(time.monotonic() - t0, 2), self.ObjectiveValue(), self.BestObjectiveBound()))

    st = s.solve(model, CB())
    obj = s.objective_value if st in (cp_model.OPTIMAL, cp_model.FEASIBLE) else None
    return s, st, {
        "status": s.status_name(st), "wall": round(time.monotonic() - t0, 2), "objective": obj,
        "bound": s.best_objective_bound, "gap": round((obj - s.best_objective_bound) / obj, 4) if obj else None,
        "solutions": len(pts), "first": pts[0] if pts else None, "last_improvement": pts[-1] if pts else None,
    }


def spreads(solver, lenses):
    return {l.label: round((max(solver.value(d) for d in l.deviations) - min(solver.value(d) for d in l.deviations)) / scheduler.SCALE, 1)
            for l in lenses if l.graded}


def add_run_cuts(model, variables):
    """Valid lower bound on handovers: a single-role run lasts at most 3 days
    (the hybrid/daily consecutive-night limit), so an ISO week with n horizon
    days needs >= ceil(n/3)-1 changes of person, each worth 2 transition units.
    Applied only to primary/secondary weeks where every member that has a
    variable on some day of the week has one on every day (no gap would hide a
    transition) and no day-off block longer than 3 days is involved."""
    from datetime import timedelta
    days = [START + timedelta(i) for i in range((END - START).days + 1)]
    by_name = CAPTURED[id(model)].get("by_name", {})
    weeks = {}
    for i, d in enumerate(days):
        weeks.setdefault(d.isocalendar()[:2], []).append(i)
    added = 0
    for idx in weeks.values():
        n = len(idx)
        need = 2 * (-(-n // 3) - 1)
        if need <= 0:
            continue
        for role in (AssignmentRole.primary, AssignmentRole.secondary):
            members_seen = {m for (d, r, m) in variables if r == role and d in idx}
            if any((d, role, m) not in variables for m in members_seen for d in idx):
                continue
            trans = [by_name.get(f"transition_{d}_{role}_{m}") for d in idx[1:] for m in members_seen]
            if any(t is None for t in trans):
                continue
            model.add(sum(trans) >= need)
            added += 1
    return added


CAPT_OBJ = {}
_orig_minimize = cp_model.CpModel.minimize


def _capturing_minimize(self, expr):
    CAPT_OBJ[id(self)] = expr
    return _orig_minimize(self, expr)


cp_model.CpModel.minimize = _capturing_minimize


def build_runs(max_run=3, spacing_cut=False, drop_weekly=False):
    """Production pass-1 model with the continuity family re-expressed as runs.

    marginal_cost call order in _build_model: fairness, preference, continuity,
    weekly spacing. The 3rd call is zeroed so the original transition terms
    leave the objective; a run decomposition x[d,r,m] == sum(runs covering d)
    is added per ISO week, and each (role, week) costs 2*cost*(runs - 1).
    """
    from datetime import timedelta
    calls = [0]
    orig = scheduler.marginal_cost

    def mc(w, st):
        calls[0] += 1
        if calls[0] == 3 or (drop_weekly and calls[0] == 4):
            return 0
        return orig(w, st)

    scheduler.marginal_cost = mc
    try:
        model, variables, conflicts, lenses = scheduler._build_model(
            starts_on=START, ends_on=END, mode=policy.rotation_mode, members=members,
            historical_points=hist.points, holidays=hol, historical_lenses=hist.lenses,
            history_window=window, fairness_weight=policy.fairness_weight,
            continuity_weight=policy.continuity_weight, preference_weight=policy.preference_weight,
            late_shift_anchor=policy.late_shift_anchor, spacing=True, acceptance_cap=ACCEPTANCE_POINTS,
        )
    finally:
        scheduler.marginal_cost = orig
    cost = orig(policy.continuity_weight, 1) * (1 if policy.rotation_mode.value == "hybrid" else 10)
    days = [START + timedelta(i) for i in range((END - START).days + 1)]
    weeks = {}
    for i, d in enumerate(days):
        weeks.setdefault(d.isocalendar()[:2], []).append(i)
    extra = []
    nruns = 0
    member_week_runs = {}
    for role in AssignmentRole:
        role_max = max_run if role != AssignmentRole.late_shift else 5
        for wk, idx in weeks.items():
            week_runs = []
            for m in range(len(members)):
                cover = {d: [] for d in idx}
                for a in range(len(idx)):
                    for b in range(a, min(len(idx), a + role_max)):
                        ds = idx[a:b + 1]
                        if not all((d, role, m) in variables for d in ds):
                            break
                        r = model.new_bool_var(f"run_{role}_{m}_{ds[0]}_{ds[-1]}")
                        week_runs.append(r)
                        if role != AssignmentRole.late_shift:
                            member_week_runs.setdefault((m, wk), []).append((len(ds) - 1) * r)
                        nruns += 1
                        for d in ds:
                            cover[d].append(r)
                for d in idx:
                    if (d, role, m) in variables:
                        model.add(variables[(d, role, m)] == sum(cover[d]))
            if week_runs:
                extra.append(2 * cost * (sum(week_runs) - 1))
    if spacing_cut:
        by_name = CAPTURED[id(model)].get("by_name", {})
        for (m, (year, week)), terms in member_week_runs.items():
            sd = by_name.get(f"second_duty_{m}_{year}_{week}")
            if sd is not None:
                model.add(sd >= sum(terms))
    model.minimize(CAPT_OBJ[id(model)] + sum(extra))
    return model, variables, lenses, nruns


def production_value(solution_vars, sol_solver):
    """Evaluate an assignment under the production objective."""
    model, variables, _, _ = build()
    model.clear_hints()
    seen = set()
    for key, var in variables.items():
        if var.index in seen or key not in solution_vars:
            continue
        seen.add(var.index)
        model.add(var == sol_solver.boolean_value(solution_vars[key]))
    s, st, info = solve(model, 20)
    return info


for exp in EXPERIMENTS:
    out = {"experiment": exp, "range": [str(START), str(END)], "budget": BUDGET, "workers": WORKERS, "mode": policy.rotation_mode.value}
    t = time.monotonic()
    if exp in ("full", "lin2", "nohint", "fixed_search", "cuts"):
        model, variables, conflicts, lenses = build()
        params = {}
        if exp == "cuts":
            out["cuts_added"] = add_run_cuts(model, variables)
        if exp == "lin2":
            params["linearization_level"] = 2
        if exp == "nohint":
            model.clear_hints()
        if exp == "fixed_search":
            params["search_branching"] = cp_model.FIXED_SEARCH
        s, st, info = solve(model, BUDGET, **params)
        out.update(info, spreads=spreads(s, lenses) if info["objective"] is not None else None)
        if info["objective"] is not None:
            out["breakdown"] = breakdown(s, model)
    elif exp == "fair_only":
        model, variables, conflicts, lenses = build(fair_only=True)
        s, st, info = solve(model, BUDGET)
        out.update(info, spreads=spreads(s, lenses) if info["objective"] is not None else None)
    elif exp == "warm":
        m1, v1, _, l1 = build(fair_only=True)
        s1, st1, info1 = solve(m1, BUDGET / 3)
        out["stage1"] = info1
        model, variables, conflicts, lenses = build()
        model.clear_hints()
        hinted = {}
        for key, var in variables.items():
            if key in v1:
                hinted[var.index] = (var, s1.boolean_value(v1[key]))
        for var, value in hinted.values():
            model.add_hint(var, value)
        s, st, info = solve(model, max(1.0, BUDGET - (time.monotonic() - t)))
        out.update(info, spreads=spreads(s, lenses) if info["objective"] is not None else None)
    elif exp == "lex":
        m1, v1, _, l1 = build(fair_only=True)
        s1, st1, info1 = solve(m1, BUDGET / 2)
        out["stage1"] = info1
        best_fair = s1.value(fairness_units(m1))
        model, variables, conflicts, lenses = build()
        model.add(fairness_units(model) <= best_fair)
        model.clear_hints()
        hinted = {}
        for key, var in variables.items():
            if key in v1:
                hinted[var.index] = (var, s1.boolean_value(v1[key]))
        for var, value in hinted.values():
            model.add_hint(var, value)
        s, st, info = solve(model, max(1.0, BUDGET - (time.monotonic() - t)))
        out.update(info, spreads=spreads(s, lenses) if info["objective"] is not None else None)
        if info["objective"] is not None:
            out["breakdown"] = breakdown(s, model)
            out["stage1_proven"] = info1["status"] == "OPTIMAL"
    elif exp in ("runs", "runs2", "runs_noweekly"):
        model, variables, lenses, nruns = build_runs(spacing_cut=exp == "runs2", drop_weekly=exp == "runs_noweekly")
        out["run_vars"] = nruns
        s, st, info = solve(model, BUDGET)
        out.update(info, spreads=spreads(s, lenses) if info["objective"] is not None else None)
        if info["objective"] is not None:
            out["production_objective_of_solution"] = production_value(variables, s)
    out["total_wall"] = round(time.monotonic() - t, 1)
    print(json.dumps(out, ensure_ascii=False), flush=True)
