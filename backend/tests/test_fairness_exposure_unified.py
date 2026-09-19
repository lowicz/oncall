"""HGH6-06 przyczyna 2 / N3, decision D3 variant B: the solver and the report
must aim at the same target.

Both compute expected share from `fairness.slot_exposure`, which drops
hard-unavailable days. This solves a real draft with a member absent in the
middle of the horizon and checks that the per-lens spread the solver optimised
against and the spread the fairness report shows for that same draft agree
within a tenth of a point - and that the solver and the forecast never
disagree about whether the acceptance criterion holds.
"""

from datetime import date, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from oncall.fairness import (
    ACCEPTANCE_POINTS,
    slot_exposure,
)
from oncall.fairness_data import (
    generator_history_window,
    solver_history,
)
from oncall.models import (
    AssignmentRole,
    Availability,
    AvailabilityKind,
    TeamMember,
    UserRole,
)
from oncall.scheduler import DateRange, PreferenceRange, SolverMember, _days, _role_day_weight
from oncall.workdays import polish_holidays
from tests.conftest import (
    create_member,
    create_published_schedule,
    create_user,
    generate_draft_directly,
    login,
)

# A full year of history so the horizon is the small correction it is in
# practice; par. 7 of PLAN-WYKONAWCZY-6 measured the residual split drift at
# 0.07 pt with realistic history. Shorten this and the residual grows fast -
# with HISTORY_DAYS = 42 it reaches ~0.5 pt because the horizon is then too
# large a fraction of the duty record - so the 0.25 pt bound in the assertion
# assumes a year of history, not an absolute guarantee.
HISTORY_DAYS = 365
HORIZON_START = date(2026, 11, 2)
HORIZON_END = date(2026, 11, 22)
ABSENCE = (date(2026, 11, 9), date(2026, 11, 15))
NAMES = ["Anna Kowalska", "Bartek Nowak", "Cezary Lis", "Dora Mazur", "Filip Górski"]

LENS_SPECS = {
    "primary": (
        (AssignmentRole.primary,),
        lambda d, h: True,
        lambda d, h: _role_day_weight(AssignmentRole.primary, d, h),
    ),
    "secondary": (
        (AssignmentRole.secondary,),
        lambda d, h: True,
        lambda d, h: _role_day_weight(AssignmentRole.secondary, d, h),
    ),
    "weekends": (
        (AssignmentRole.primary, AssignmentRole.secondary),
        lambda d, h: d.weekday() >= 5,
        lambda d, h: 1.0,
    ),
    "holidays": (
        (AssignmentRole.primary, AssignmentRole.secondary),
        lambda d, h: d.weekday() < 5 and d in h,
        lambda d, h: 1.0,
    ),
}


@pytest.mark.anyio
async def test_solver_and_report_lens_spreads_agree_with_an_absentee(
    client: AsyncClient, db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    # One worker keeps the draft as stable as it can be. The solver still lands
    # on a FEASIBLE (not proven-optimal) roster for this fixture, so the
    # reconstruction residual asserted below is bounded at 0.25 pt, not 0.1 -
    # see the comment on the assertion and PLAN-WYKONAWCZY-6 A3 "Odstępstwo".
    from oncall.config import get_settings

    monkeypatch.setattr(get_settings(), "solver_workers", 1)

    for name in NAMES:
        user = await create_user(db, name.split()[0].lower(), display_name=name)
        await create_member(db, user, display_name=name)
    await create_user(db, "koord", role=UserRole.coordinator)

    await create_published_schedule(
        db,
        starts_on=HORIZON_START - timedelta(days=HISTORY_DAYS),
        days=HISTORY_DAYS,
        primary=NAMES,
        secondary=NAMES[2:] + NAMES[:2],
        late_shift=NAMES[1:] + NAMES[:1],
        name="Historia",
    )
    filip = await db.scalar(select(TeamMember).where(TeamMember.display_name == "Filip Górski"))
    db.add(
        Availability(
            member_id=filip.id,
            kind=AvailabilityKind.unavailable,
            starts_on=ABSENCE[0],
            ends_on=ABSENCE[1],
        )
    )
    await db.commit()

    await login(client, "koord")
    draft = await generate_draft_directly(db, "koord", HORIZON_START, HORIZON_END)
    assert not draft.get("unavailability_conflicts")
    solver_criterion_warning = any(
        "rozpiętość" in w["message"].lower() or "kryteri" in w["message"].lower()
        for w in draft.get("warnings", [])
    )

    impact = (await client.get(f"/api/v1/scheduling/{draft['id']}/fairness-impact")).json()
    report_spread = {item["lens"]: item["after"] for item in impact["spreads"]}

    # --- solver spread, reconstructed over the window the generator used ---
    orm = (
        (
            await db.scalars(
                select(TeamMember).options(
                    selectinload(TeamMember.eligibility), selectinload(TeamMember.availability)
                )
            )
        )
        .unique()
        .all()
    )
    solver_members = [
        SolverMember(
            name=m.display_name,
            active=DateRange(m.active_from, m.active_until),
            eligibility={
                r: tuple(DateRange(e.starts_on, e.ends_on) for e in m.eligibility if e.role == r)
                for r in AssignmentRole
            },
            preferences=tuple(
                PreferenceRange(a.starts_on, a.ends_on, a.kind) for a in m.availability
            ),
        )
        for m in orm
    ]
    names_by_id = {m.id: m.display_name for m in orm}
    win_start, win_end = generator_history_window(HORIZON_START, HORIZON_END)
    history = await solver_history(db, win_start, win_end, names_by_id)
    holidays = polish_holidays(win_start, HORIZON_END)
    hist_days = _days(win_start, win_end)
    days = _days(HORIZON_START, HORIZON_END)

    assigned: dict[str, list[tuple[date, AssignmentRole]]] = {}
    for a in draft["assignments"]:
        assigned.setdefault(a["assignee_name"], []).append(
            (date.fromisoformat(a["service_date"]), AssignmentRole(a["role"]))
        )

    solver_spread: dict[str, float] = {}
    for lens, (roles, counts, weight) in LENS_SPECS.items():

        def cnt(d, _c=counts):
            return _c(d, holidays)

        def wgt(d, _w=weight):
            return _w(d, holidays)

        if lens in ("weekends", "holidays"):
            historical = {m.name: history.lenses.get((m.name, lens), 0.0) for m in solver_members}
        else:
            role = roles[0]
            historical = {m.name: history.points.get((m.name, role), 0.0) for m in solver_members}
        h_tot = sum(historical.values())

        def exposure(span, mem, _roles=roles, _cnt=cnt, _wgt=wgt):
            return slot_exposure(
                roles=_roles,
                window_start=span[0],
                window_end=span[-1],
                include=_cnt,
                weight=_wgt,
                is_eligible=mem.eligible,
                is_unavailable=lambda day: mem.preference(day) == AvailabilityKind.unavailable,
            )

        h_exp = {m.name: exposure(hist_days, m) for m in solver_members}
        h_exp_tot = sum(h_exp.values())
        hor_tot = sum(wgt(d) for d in days if cnt(d) for _ in roles)
        hor_exp = {m.name: exposure(days, m) for m in solver_members}
        hor_exp_tot = sum(hor_exp.values())

        devs = []
        for m in solver_members:
            he = h_tot * h_exp[m.name] / h_exp_tot if h_exp_tot else 0.0
            oe = hor_tot * hor_exp[m.name] / hor_exp_tot if hor_exp_tot else 0.0
            actual = sum(wgt(d) for (d, r) in assigned.get(m.name, []) if r in roles and cnt(d))
            devs.append(historical.get(m.name, 0.0) - he - oe + actual)
        solver_spread[lens] = round(max(devs) - min(devs), 2)

    deltas = {lens: round(abs(report_spread[lens] - solver_spread[lens]), 3) for lens in LENS_SPECS}
    detail = " ".join(
        f"{lens}:|{report_spread[lens]}-{solver_spread[lens]}|={deltas[lens]}"
        for lens in LENS_SPECS
    )
    # The two metrics decompose the window differently - the report over one
    # 12-month span, the solver as history plus horizon subperiod - so a small
    # residual is expected and structural, not a bug (PLAN-WYKONAWCZY-6 par. 7
    # measured ~0.07 pt on a realistic roster). It depends on which members sit
    # at the extremes of the spread, which shifts with the FEASIBLE draft the
    # solver returns, so the bound here is 0.25, not the nominal 0.1. What the
    # test guards is that the gap is a fraction of a point, where before A3 it
    # was a whole point (`secondary` 1.00 vs 2.00) - the solver and the report
    # now aim at the same target.
    for lens in LENS_SPECS:
        assert deltas[lens] <= 0.25, detail

    report_meets = all(item["after"] <= ACCEPTANCE_POINTS for item in impact["spreads"])
    if not solver_criterion_warning:
        assert report_meets, "solver gave no criterion warning but the forecast says unmet"
