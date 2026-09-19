"""How much of the "przed -> po" change is the draft, and how much is the window sliding?

`draft_fairness_impact` computes its baseline over [starts_on-1-365, starts_on-1]
and its projection over [ends_on-365, ends_on]. Those are different windows, so
part of every reported change is simply the oldest days ageing out. This run
measures the history alone in the projection window, with no draft at all.
"""
import asyncio
import json
import sys
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from oncall.database import SessionFactory
from oncall.fairness import EligibilityPeriod, FairnessMemberInput, compute_fairness
from oncall.fairness_data import resolved_duties
from oncall.models import AssignmentRole, TeamMember
from oncall.workdays import polish_holidays

LENSES = ("primary", "secondary", "late_shift", "weekends", "holidays")


def spread(c):
    return {l: round(max(getattr(m, l).deviation for m in c.members)
                     - min(getattr(m, l).deviation for m in c.members), 2) for l in LENSES}


async def main() -> None:
    starts_on = date.fromisoformat(sys.argv[1])
    ends_on = date.fromisoformat(sys.argv[2])
    baseline_end = starts_on - timedelta(days=1)
    baseline_start = baseline_end - timedelta(days=365)
    projected_start = ends_on - timedelta(days=365)
    async with SessionFactory() as db:
        orm = ((await db.scalars(select(TeamMember).options(
            selectinload(TeamMember.eligibility)))).unique().all())
        members = [FairnessMemberInput(
            id=m.id, display_name=m.display_name, active_from=m.active_from,
            active_until=m.active_until,
            eligibility={r: [EligibilityPeriod(e.starts_on, e.ends_on)
                             for e in m.eligibility if e.role == r] for r in AssignmentRole})
            for m in orm]
        historical = await resolved_duties(db, min(baseline_start, projected_start), baseline_end)
    days = polish_holidays(min(baseline_start, projected_start), ends_on)
    before = compute_fairness(members, historical, holidays=days,
                              window_start=baseline_start, window_end=baseline_end)
    drift = compute_fairness(members, historical, holidays=days,
                             window_start=projected_start, window_end=ends_on)
    print(json.dumps({
        "okno_przed": [baseline_start.isoformat(), baseline_end.isoformat()],
        "okno_po": [projected_start.isoformat(), ends_on.isoformat()],
        "przed_jak_w_panelu": spread(before),
        "sama_historia_w_oknie_po": spread(drift),
    }, ensure_ascii=False))


asyncio.run(main())
