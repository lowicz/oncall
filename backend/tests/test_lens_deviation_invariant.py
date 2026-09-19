"""HGH6-06 przyczyna 1 / N2: every fairness lens has to balance on its own.

`scheduler.balance` computes each lens's ``mean`` before solving. Exactly one
person holds each ``(day, role)`` slot, so once the model is solved the member
deviations must sum to ``mean * len(members)`` - i.e. the deviations from the
mean sum to zero, bar rounding. That held for the single-role lenses and broke
for ``weekends`` and ``holidays``: they span both on-call roles and so fill two
slots a day, while ``horizon_total`` counted one, leaving ``mean`` low by half
the lens's weekend/holiday load.

This checks the invariant against the solver's own ``_Lens`` objects.
"""

from datetime import date, timedelta

from ortools.sat.python import cp_model

from oncall.models import AssignmentRole, LateShiftAnchor, RotationMode
from oncall.scheduler import SCALE, DateRange, SolverMember, _build_model
from oncall.workdays import polish_holidays

# 4 weeks from a Monday: four weekends, plus 11-11 (Independence Day, a Wednesday).
STARTS = date(2026, 11, 2)
ENDS = date(2026, 11, 29)


def _member(name: str) -> SolverMember:
    active = DateRange(date(2025, 1, 1), None)
    return SolverMember(
        name=name,
        active=active,
        eligibility={role: (active,) for role in AssignmentRole},
        preferences=(),
    )


def test_every_lens_deviation_sums_to_its_mean_after_solving() -> None:
    members = [_member(n) for n in ("Anna", "Bartek", "Cezary", "Dora", "Ewa")]
    holidays = polish_holidays(STARTS - timedelta(days=365), ENDS)
    assert any(
        d.month == 11 and d.day == 11 and d in holidays
        for d in (STARTS + timedelta(days=i) for i in range((ENDS - STARTS).days + 1))
    ), "expected the 11-11 holiday inside the horizon"

    model, _variables, conflicts, lenses = _build_model(
        starts_on=STARTS,
        ends_on=ENDS,
        mode=RotationMode.hybrid,
        members=members,
        historical_points={
            ("Anna", AssignmentRole.primary): 40.0,
            ("Bartek", AssignmentRole.secondary): 25.0,
        },
        holidays=holidays,
        historical_lenses={("Anna", "weekends"): 6.0, ("Cezary", "holidays"): 2.0},
        history_window=None,
        fairness_weight=3.0,
        continuity_weight=1.0,
        preference_weight=2.0,
        late_shift_anchor=LateShiftAnchor.secondary,
        spacing=True,
    )
    assert conflicts == []
    labels = {lens.label for lens in lenses}
    assert {"primary", "secondary", "late_shift", "weekends", "holidays"} <= labels

    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = 20.0
    solver.parameters.num_workers = 4
    status = solver.solve(model)
    assert status in (cp_model.OPTIMAL, cp_model.FEASIBLE)

    for lens in lenses:
        total = sum(solver.value(deviation) for deviation in lens.deviations)
        expected = lens.mean * len(lens.deviations)
        # Each per-member baseline and the mean are rounded once, so the drift
        # is bounded by half a SCALE unit per member.
        assert abs(total - expected) <= SCALE * len(lens.deviations) // 2 + len(lens.deviations), (
            f"{lens.label}: sum={total}, mean*n={expected}"
        )
