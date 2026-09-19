import asyncio, json, sys
from datetime import date, timedelta
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from oncall.database import SessionFactory
from oncall.fairness_data import history_window, solver_history
from oncall.models import AssignmentRole, LateShiftAnchor, RotationMode, TeamMember
from oncall.scheduler import DateRange, PreferenceRange, SolverMember, generate_schedule
from oncall.workdays import polish_holidays

case = json.loads(sys.argv[1])
starts_on = date.fromisoformat(case["start"])
ends_on = starts_on + timedelta(days=case["days"] - 1)

async def load():
    async with SessionFactory() as db:
        orm = ((await db.scalars(select(TeamMember).options(
            selectinload(TeamMember.eligibility), selectinload(TeamMember.availability)
        ))).unique().all())
        members = [SolverMember(
            name=m.display_name, active=DateRange(m.active_from, m.active_until),
            eligibility={r: tuple(DateRange(e.starts_on, e.ends_on) for e in m.eligibility if e.role == r)
                         for r in AssignmentRole},
            preferences=tuple(PreferenceRange(a.starts_on, a.ends_on, a.kind) for a in m.availability),
        ) for m in orm]
        history = await solver_history(db, starts_on, {m.id: m.display_name for m in orm})
        return members, history

members, history = asyncio.run(load())
generate_schedule(
    starts_on=starts_on, ends_on=ends_on, mode=RotationMode(case.get("mode", "hybrid")),
    members=members, historical_points=history.points,
    holidays=polish_holidays(history_window(starts_on)[0], ends_on),
    historical_lenses=history.lenses, history_window=history_window(starts_on),
    late_shift_anchor=LateShiftAnchor.secondary,
    solver_workers=case.get("workers"), solve_seconds=case.get("seconds", 90.0),
    log_search_progress=True,
)
