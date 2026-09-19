"""QA6: czy solver i raport mierza to samo kryterium na tym samym szkicu?

Uruchamia solver w procesie, a nastepnie liczy rozpietosc soczewek dwoma
sposobami: wzorem raportu (oncall.fairness) i wzorem solvera (scheduler.balance).
"""
import asyncio
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from oncall.database import SessionFactory
from oncall.models import AssignmentRole, AvailabilityKind, LateShiftAnchor, RotationMode, TeamMember
from oncall.scheduler import (
    DateRange, PreferenceRange, SolverMember, generate_schedule, _days, _role_day_weight,
)
from oncall.fairness import (
    EligibilityPeriod, FairnessDuty, FairnessMemberInput, compute_fairness, lens_spread,
)
from oncall.fairness_data import generator_history_window, solver_history, resolved_duties
from oncall.workdays import polish_holidays, is_working_day

STARTS, ENDS = date(2026, 10, 5), date(2026, 11, 1)


async def main():
    async with SessionFactory() as db:
        orm = (await db.scalars(select(TeamMember).options(
            selectinload(TeamMember.eligibility), selectinload(TeamMember.availability)
        ))).unique().all()
        members = [SolverMember(
            name=m.display_name,
            active=DateRange(m.active_from, m.active_until),
            eligibility={r: tuple(DateRange(e.starts_on, e.ends_on)
                                  for e in m.eligibility if e.role == r) for r in AssignmentRole},
            preferences=tuple(PreferenceRange(a.starts_on, a.ends_on, a.kind)
                              for a in m.availability),
        ) for m in orm]
        names = {m.id: m.display_name for m in orm}
        ws, we = generator_history_window(STARTS, ENDS)
        hist = await solver_history(db, ws, we, names)
        hol = polish_holidays(ws, ENDS)

        res = generate_schedule(
            starts_on=STARTS, ends_on=ENDS, mode=RotationMode.hybrid, members=members,
            historical_points=hist.points, holidays=hol, historical_lenses=hist.lenses,
            history_window=(ws, we), late_shift_anchor=LateShiftAnchor.secondary,
            solve_seconds=30.0,
        )
        print("status:", res.status, "| floor:", res.acceptance_floor,
              "| ostrzezenia:", list(res.warnings))

        # --- metryka raportu ---
        w_start, w_end = ENDS - timedelta(days=365), ENDS
        fm = [FairnessMemberInput(
            id=m.id, display_name=m.display_name, active_from=m.active_from,
            active_until=m.active_until,
            eligibility={r: [EligibilityPeriod(e.starts_on, e.ends_on)
                             for e in m.eligibility if e.role == r] for r in AssignmentRole},
        ) for m in orm]
        by_name = {m.display_name: m.id for m in orm}
        hist_duties = await resolved_duties(db, w_start, w_end)
        draft = [FairnessDuty(a.service_date, a.role, a.assignee_name,
                              by_name.get(a.assignee_name)) for a in res.assignments]
        comp = compute_fairness(fm, hist_duties + draft, holidays=polish_holidays(w_start, w_end),
                                window_start=w_start, window_end=w_end)
        print("\nrozpietosc wg RAPORTU:")
        for lens in ("primary", "secondary", "weekends", "holidays"):
            print(f"  {lens:10} {lens_spread(comp.members, lens):6.2f}")

        # --- metryka solvera, odtworzona ---
        days = _days(STARTS, ENDS)
        hist_days = _days(ws, we)
        print("\nrozpietosc wg SOLVERA (odtworzona z scheduler.balance):")
        assigned = {}
        for a in res.assignments:
            assigned.setdefault(a.assignee_name, []).append((a.service_date, a.role))

        def lens_calc(label, roles, counts, weight, historical):
            # Sums run over (day, role) slots, matching scheduler.balance after
            # the HGH6-06 fix (weekends/holidays span both on-call roles).
            def exposed_slots(m, d):
                if counts(d) and m.preference(d) != AvailabilityKind.unavailable:
                    return sum(1 for r in roles if m.eligible(r, d))
                return 0
            h_tot = sum(historical.get(m.name, 0.0) for m in members)
            h_exp = {m.name: sum(weight(d) * exposed_slots(m, d) for d in hist_days) for m in members}
            h_exp_tot = sum(h_exp.values())
            hor_tot = sum(weight(d) for d in days if counts(d) for _ in roles)
            hor_exp = {m.name: sum(weight(d) * exposed_slots(m, d) for d in days) for m in members}
            hor_exp_tot = sum(hor_exp.values())
            devs = {}
            for m in members:
                he = h_tot * h_exp[m.name] / h_exp_tot if h_exp_tot else 0.0
                oe = hor_tot * hor_exp[m.name] / hor_exp_tot if hor_exp_tot else 0.0
                actual_hor = sum(weight(d) for (d, r) in assigned.get(m.name, [])
                                 if r in roles and counts(d))
                devs[m.name] = historical.get(m.name, 0.0) - he - oe + actual_hor
            return devs, hor_tot, sum(
                sum(weight(d) for (d, r) in assigned.get(m.name, []) if r in roles and counts(d))
                for m in members)

        specs = [
            ("primary", (AssignmentRole.primary,), lambda d: True,
             lambda d: _role_day_weight(AssignmentRole.primary, d, hol),
             {m.name: hist.points.get((m.name, AssignmentRole.primary), 0.0) for m in members}),
            ("secondary", (AssignmentRole.secondary,), lambda d: True,
             lambda d: _role_day_weight(AssignmentRole.secondary, d, hol),
             {m.name: hist.points.get((m.name, AssignmentRole.secondary), 0.0) for m in members}),
            ("weekends", (AssignmentRole.primary, AssignmentRole.secondary),
             lambda d: d.weekday() >= 5, lambda d: 1,
             {m.name: hist.lenses.get((m.name, "weekends"), 0.0) for m in members}),
            ("holidays", (AssignmentRole.primary, AssignmentRole.secondary),
             lambda d: d.weekday() < 5 and d in hol, lambda d: 1,
             {m.name: hist.lenses.get((m.name, "holidays"), 0.0) for m in members}),
        ]
        for label, roles, counts, weight, historical in specs:
            devs, hor_tot, real_tot = lens_calc(label, roles, counts, weight, historical)
            sp = max(devs.values()) - min(devs.values())
            print(f"  {label:10} {sp:6.2f}   (horizon_total solvera={hor_tot}, "
                  f"faktycznie przydzielono={real_tot})")


asyncio.run(main())
