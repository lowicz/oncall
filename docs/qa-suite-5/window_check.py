"""Does the solver optimize the same window the fairness report displays?

Before Z1 it did not. The generator scored a horizon against
`history_window(starts_on)` - the twelve months ending the day before the
horizon opens - while `draft_fairness_impact` and `/api/v1/fairness` reported
the twelve months ending on the horizon's LAST day. For a 28 day horizon the
two differed by the 28 oldest days of history, which the report silently
dropped (BLK5-01).

Since Z1 the generator uses `generator_history_window(starts_on, ends_on)`,
which is the history that will still be inside the rolling window once the
horizon closes. This script now proves the two views agree: it prints the same
draft measured in the solver's window and in the report's window.
"""
import asyncio
import json
import sys
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from oncall.database import SessionFactory
from oncall.fairness import EligibilityPeriod, FairnessDuty, FairnessMemberInput, compute_fairness
from oncall.fairness_data import (
    generator_history_window,
    history_window,
    resolved_duties,
    solver_history,
)
from oncall.models import AssignmentRole, LateShiftAnchor, RotationMode, TeamMember
from oncall.scheduler import DateRange, PreferenceRange, SolverMember, generate_schedule
from oncall.workdays import polish_holidays

LENSES = ("primary", "secondary", "late_shift", "weekends", "holidays")


def spread(c):
    return {l: round(max(getattr(m, l).deviation for m in c.members)
                     - min(getattr(m, l).deviation for m in c.members), 2) for l in LENSES}


async def main() -> None:
    case = json.loads(sys.argv[1])
    starts_on = date.fromisoformat(case["start"])
    ends_on = starts_on + timedelta(days=case["days"] - 1)
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
            FairnessMemberInput(id=m.id, display_name=m.display_name, active_from=m.active_from,
                                active_until=m.active_until,
                                eligibility={r: [EligibilityPeriod(e.starts_on, e.ends_on)
                                                 for e in m.eligibility if e.role == r]
                                             for r in AssignmentRole})
            for m in orm
        ]
        names = {m.id: m.display_name for m in orm}
        window_start, window_end = generator_history_window(starts_on, ends_on)
        history = await solver_history(db, window_start, window_end, names)
        historical = await resolved_duties(db, window_start, window_end)
        # The old anchored window, kept only to show what it used to drop.
        anchored_start, _ = history_window(starts_on)
    holidays = polish_holidays(anchored_start, ends_on)
    result = generate_schedule(
        starts_on=starts_on, ends_on=ends_on, mode=RotationMode(case.get("mode", "hybrid")),
        members=solver_members, historical_points=history.points, holidays=holidays,
        historical_lenses=history.lenses, history_window=(window_start, window_end),
        fairness_weight=case.get("fairness", 3.0), continuity_weight=case.get("continuity", 1.0),
        preference_weight=case.get("preference", 2.0),
        late_shift_anchor=LateShiftAnchor(case.get("anchor", "secondary")),
        solver_workers=case.get("workers"), solve_seconds=case.get("seconds", 90.0),
    )
    draft = [FairnessDuty(i.service_date, i.role, i.assignee_name) for i in result.assignments]
    days = polish_holidays(anchored_start, ends_on)
    anchored = compute_fairness(fairness_members, historical + draft, holidays=days,
                                window_start=window_start, window_end=ends_on)
    sliding = compute_fairness(fairness_members, historical + draft, holidays=days,
                               window_start=ends_on - timedelta(days=365), window_end=ends_on)
    before = compute_fairness(fairness_members, historical, holidays=days,
                              window_start=window_start, window_end=window_end)
    solver_spread = spread(anchored)
    report_spread = spread(sliding)
    print(json.dumps({
        "case": case, "status": result.status,
        "okno_solvera": [window_start.isoformat(), ends_on.isoformat()],
        "okno_raportu": [(ends_on - timedelta(days=365)).isoformat(), ends_on.isoformat()],
        "przed": spread(before),
        "po_w_oknie_solvera": solver_spread,
        "po_w_oknie_raportu": report_spread,
        "rozjazd": {lens: round(solver_spread[lens] - report_spread[lens], 2)
                    for lens in LENSES},
    }, ensure_ascii=False))
    for member in sorted(anchored.members, key=lambda m: m.display_name):
        other = next(m for m in sliding.members if m.member_id == member.member_id)
        print(f"  {member.display_name:22} primary kotwiczone {member.primary.deviation:+6.2f}"
              f"  kroczace {other.primary.deviation:+6.2f}"
              f" | secondary kotwiczone {member.secondary.deviation:+6.2f}"
              f"  kroczace {other.secondary.deviation:+6.2f}")


asyncio.run(main())
