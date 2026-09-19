"""Z5 proof: both preflight branches.

Branch FEASIBLE: on this data (post-Z1 rolling window) the criterion must be
met by construction - the run succeeds and the solver-side lens spreads stay
within ACCEPTANCE_POINTS.

Branch INFEASIBLE: the same generation fed the pre-Z1 anchored window (the
state without Z1, floor measured at 6 points in round 5) must not stay
silent - acceptance_floor must say 6.
"""
import asyncio
import json
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from oncall.database import SessionFactory
from oncall.fairness_data import generator_history_window, history_window, solver_history
from oncall.models import AssignmentRole, LateShiftAnchor, RotationMode, TeamMember
from oncall.scheduler import (
    ACCEPTANCE_POINTS, DateRange, PreferenceRange, SolverMember, generate_schedule,
)
from oncall.workdays import polish_holidays

START = date(2026, 9, 7)
DAYS = 28


async def load(window):
    ends_on = START + timedelta(days=DAYS - 1)
    async with SessionFactory() as db:
        orm = ((await db.scalars(select(TeamMember).options(
            selectinload(TeamMember.eligibility), selectinload(TeamMember.availability)
        ))).unique().all())
        members = [SolverMember(
            name=m.display_name, active=DateRange(m.active_from, m.active_until),
            eligibility={r: tuple(DateRange(e.starts_on, e.ends_on)
                                  for e in m.eligibility if e.role == r) for r in AssignmentRole},
            preferences=tuple(PreferenceRange(a.starts_on, a.ends_on, a.kind)
                              for a in m.availability)) for m in orm]
        names = {m.id: m.display_name for m in orm}
        history = await solver_history(db, *window, names)
    return members, history


async def main() -> None:
    ends_on = START + timedelta(days=DAYS - 1)
    holidays = polish_holidays(history_window(START)[0], ends_on)

    # Branch 1: the post-Z1 window. Preflight must say FEASIBLE.
    members, history = await load(generator_history_window(START, ends_on))
    result = generate_schedule(
        starts_on=START, ends_on=ends_on, mode=RotationMode.hybrid, members=members,
        historical_points=history.points, holidays=holidays,
        historical_lenses=history.lenses,
        history_window=generator_history_window(START, ends_on),
        late_shift_anchor=LateShiftAnchor.secondary, solver_workers=2, solve_seconds=90,
    )
    print(json.dumps({
        "branch": "FEASIBLE", "status": result.status,
        "acceptance_floor": result.acceptance_floor, "warnings": list(result.warnings),
    }, ensure_ascii=False), flush=True)
    assert result.assignments and result.acceptance_floor is None, "preflight powinien orzec FEASIBLE"

    # Branch 2: the pre-Z1 anchored window. The criterion is unattainable and
    # the message must name the floor instead of staying silent. Round 5
    # measured the floor at 6 points, but that cap covered all five lenses;
    # after D1 the graded family is four lenses and its floor here is 4.
    members, history = await load(history_window(START))
    result = generate_schedule(
        starts_on=START, ends_on=ends_on, mode=RotationMode.hybrid, members=members,
        historical_points=history.points, holidays=holidays,
        historical_lenses=history.lenses, history_window=history_window(START),
        late_shift_anchor=LateShiftAnchor.secondary, solver_workers=2, solve_seconds=90,
    )
    print(json.dumps({
        "branch": "INFEASIBLE", "status": result.status,
        "acceptance_floor": result.acceptance_floor, "warnings": list(result.warnings),
    }, ensure_ascii=False), flush=True)
    assert result.acceptance_floor == 4, f"oczekiwano dna 4, podano {result.acceptance_floor}"
    assert any(str(result.acceptance_floor) in w for w in result.warnings), (
        "ostrzezenie milczy o dnie"
    )
    print("Z5 PASS")


asyncio.run(main())
