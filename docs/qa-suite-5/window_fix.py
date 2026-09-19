"""Proposed fix for the window mismatch, measured against the report's metric.

The generator keeps its anchored window today. This run instead feeds it the
history that will STILL be inside the rolling window when the horizon closes:
`[ends_on - 365, starts_on - 1]`. Everything else is the production solver.
"""
import asyncio
import json
import sys
import time
from collections import defaultdict
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from oncall.database import SessionFactory
from oncall.fairness import (
    ONCALL_ROLES, EligibilityPeriod, FairnessDuty, FairnessMemberInput,
    compute_fairness, day_weight,
)
from oncall.fairness_data import SolverHistory, history_window, resolved_duties
from oncall.effective import effective_assignments
from oncall.models import AssignmentRole, LateShiftAnchor, RotationMode, TeamMember
from oncall.scheduler import DateRange, PreferenceRange, SolverMember, generate_schedule
from oncall.workdays import polish_holidays

LENSES = ("primary", "secondary", "late_shift", "weekends", "holidays")


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
        variant = case.get("okno", "kroczace")
        async with SessionFactory() as db:
            orm = (
                (await db.scalars(select(TeamMember).options(
                    selectinload(TeamMember.eligibility), selectinload(TeamMember.availability)
                ))).unique().all()
            )
            solver_members = [
                SolverMember(name=m.display_name, active=DateRange(m.active_from, m.active_until),
                             eligibility={r: tuple(DateRange(e.starts_on, e.ends_on)
                                                   for e in m.eligibility if e.role == r)
                                          for r in AssignmentRole},
                             preferences=tuple(PreferenceRange(a.starts_on, a.ends_on, a.kind)
                                               for a in m.availability))
                for m in orm
            ]
            fairness_members = [
                FairnessMemberInput(id=m.id, display_name=m.display_name,
                                    active_from=m.active_from, active_until=m.active_until,
                                    eligibility={r: [EligibilityPeriod(e.starts_on, e.ends_on)
                                                     for e in m.eligibility if e.role == r]
                                                 for r in AssignmentRole})
                for m in orm
            ]
            names = {m.id: m.display_name for m in orm}
            anchored_start, anchored_end = history_window(starts_on)
            solver_start = (ends_on - timedelta(days=365)) if variant == "kroczace" else anchored_start
            history = await history_over(db, solver_start, anchored_end, names)
            historical = await resolved_duties(db, anchored_start, anchored_end)
        holidays = polish_holidays(anchored_start, ends_on)
        began = time.perf_counter()
        result = generate_schedule(
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
        draft = [FairnessDuty(i.service_date, i.role, i.assignee_name) for i in result.assignments]
        days = polish_holidays(anchored_start, ends_on)
        before = compute_fairness(fairness_members, historical, holidays=days,
                                  window_start=anchored_start, window_end=anchored_end)
        report = compute_fairness(fairness_members, historical + draft, holidays=days,
                                  window_start=ends_on - timedelta(days=365), window_end=ends_on)
        out = {**case, "status": result.status, "elapsed": elapsed,
               "okno_historii": [solver_start.isoformat(), anchored_end.isoformat()],
               "przed": spread(before), "po_raport": spread(report)}
        out["max_po_raport"] = max(out["po_raport"].values())
        print(json.dumps(out, ensure_ascii=False), flush=True)


asyncio.run(main())
