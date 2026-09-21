"""Inherited fairness debt is repaid at a bounded pace, and reported as such.

Fed the whole 12-month deviation as the starting position of a 31-day range
whose fair share is five points per person and lens, the objective was
all-or-nothing: every slot went to the largest debtors and nobody else got a
duty until they were level, so a month after an unfair year had people with
no duties, people with one duty type, and one person with two thirds of the
month. The lens balance now levels at most half a member's share per range,
the rest of the debt waits for the next range, and the run is judged - and
the floor named - on the 12-month window the report measures.
"""

from collections import Counter, defaultdict
from datetime import date, timedelta
from itertools import pairwise

import pytest

from oncall.domain.vocabulary import AssignmentRole, LateShiftAnchor, RotationMode
from oncall.fairness import ACCEPTANCE_POINTS, day_weight, generator_history_window
from oncall.scheduler import (
    REPAYMENT_SHARE,
    DateRange,
    SolverMember,
    SolverResult,
    _criterion_warning,
    _Lens,
    _lens_balance,
    _LensBalance,
    _ModelBuildContext,
    _role_lens_definition,
    generate_schedule,
)
from oncall.workdays import polish_holidays

#: Ten seconds keeps the two-pass shape - the criterion pass skips itself
#: below that - while staying short enough for the ordinary suite.
BUDGET = 10.0
ONCALL = (AssignmentRole.primary, AssignmentRole.secondary)


def _member(name: str, active_from: date = date(2025, 1, 1)) -> SolverMember:
    active = DateRange(active_from, None)
    return SolverMember(
        name=name,
        active=active,
        eligibility={role: (active,) for role in AssignmentRole},
        preferences=(),
    )


def _points(result: SolverResult, role: AssignmentRole, holidays: set[date]) -> Counter[str]:
    points: Counter[str] = Counter()
    for item in result.assignments:
        if item.role == role:
            points[item.assignee_name] += int(
                1 if role == AssignmentRole.late_shift else day_weight(item.service_date, holidays)
            )
    return points


def _duties(result: SolverResult) -> dict[str, Counter[AssignmentRole]]:
    duties: dict[str, Counter[AssignmentRole]] = defaultdict(Counter)
    for item in result.assignments:
        duties[item.assignee_name][item.role] += 1
    return duties


def _assert_bounded_shares(
    result: SolverResult, names: list[str], holidays: set[date], label: object
) -> None:
    """Half to one and a half of the fair share on every on-call lens: no
    month of nothing, no month of everything. Everybody here is eligible
    throughout, so the share is the plain mean; the slack is the levelling
    band of the criterion plus one weekday duty of granularity."""
    for role in ONCALL:
        points = _points(result, role, holidays)
        share = sum(points.values()) / len(names)
        for name in names:
            assert points[name] >= 1, (label, role, name, points)
            assert points[name] <= 1.5 * share + 2.5, (label, role, name, share, points)


# --- the report's fixture: one range, a year of debt --------------------------

NAMES = [f"Osoba {index}" for index in range(8)]
CREDITOR, DEBTOR = NAMES[0], NAMES[1]
STARTS, ENDS = date(2026, 10, 1), date(2026, 10, 31)
HISTORY_WINDOW = generator_history_window(STARTS, ENDS)
HOLIDAYS = polish_holidays(HISTORY_WINDOW[0], ENDS)


def _year_of_debt() -> dict[tuple[str, AssignmentRole], float]:
    """Eight equal shares, except one person forty points over on PRIMARY and
    forty under on SECONDARY, and another the exact mirror - the shape of a
    real history where one person held most primaries and another most
    secondaries."""
    points = {(name, role): 60.0 for name in NAMES for role in ONCALL}
    points[(CREDITOR, AssignmentRole.primary)] = 100.0
    points[(DEBTOR, AssignmentRole.primary)] = 20.0
    points[(CREDITOR, AssignmentRole.secondary)] = 20.0
    points[(DEBTOR, AssignmentRole.secondary)] = 100.0
    return points


@pytest.fixture(scope="module")
def indebted_range() -> SolverResult:
    return generate_schedule(
        starts_on=STARTS,
        ends_on=ENDS,
        mode=RotationMode.hybrid,
        members=[_member(name) for name in NAMES],
        historical_points=_year_of_debt(),
        holidays=HOLIDAYS,
        history_window=HISTORY_WINDOW,
        solve_seconds=BUDGET,
    )


def test_a_year_of_debt_leaves_nobody_without_duties(indebted_range: SolverResult) -> None:
    assert indebted_range.conflicts == ()
    duties = _duties(indebted_range)
    for name in NAMES:
        assert duties[name][AssignmentRole.primary] >= 1, (name, duties[name])
        assert duties[name][AssignmentRole.secondary] >= 1, (name, duties[name])
    _assert_bounded_shares(indebted_range, NAMES, HOLIDAYS, "october")


def test_the_most_indebted_person_still_receives_the_most(indebted_range: SolverResult) -> None:
    primary = _points(indebted_range, AssignmentRole.primary, HOLIDAYS)
    secondary = _points(indebted_range, AssignmentRole.secondary, HOLIDAYS)
    assert primary[DEBTOR] == max(primary.values()), primary
    assert primary[CREDITOR] == min(primary.values()), primary
    assert secondary[CREDITOR] == max(secondary.values()), secondary
    assert secondary[DEBTOR] == min(secondary.values()), secondary


def test_the_floor_is_named_even_far_outside_the_criterion(indebted_range: SolverResult) -> None:
    """An eighty-point spread cannot fall under three in one month, and the
    coordinator is told where it can fall to - a number, not a shrug."""
    floor = indebted_range.acceptance_floor
    assert floor is not None
    assert floor > 10, floor
    debt = [warning for warning in indebted_range.warnings if "Zastany dług" in warning]
    assert len(debt) == 1, indebted_range.warnings
    assert f"najniższa osiągalna rozpiętość to {floor} punktów" in debt[0]
    assert "nie jakość generowania" in debt[0]
    assert "połowę jej udziału" in debt[0]


# --- the balance arithmetic, without a model ---------------------------------


def _balance(points: dict[tuple[str, AssignmentRole], float], names: list[str]) -> _LensBalance:
    context = _ModelBuildContext(
        starts_on=STARTS,
        ends_on=ENDS,
        mode=RotationMode.hybrid,
        members=[_member(name) for name in names],
        historical_points=points,
        holidays=HOLIDAYS,
        historical_lenses={},
        history_window=HISTORY_WINDOW,
        fairness_weight=3.0,
        continuity_weight=1.0,
        preference_weight=2.0,
        late_shift_anchor=LateShiftAnchor.secondary,
    )
    history_days = [
        HISTORY_WINDOW[0] + timedelta(days=offset)
        for offset in range((HISTORY_WINDOW[1] - HISTORY_WINDOW[0]).days + 1)
    ]
    horizon_days = [STARTS + timedelta(days=offset) for offset in range((ENDS - STARTS).days + 1)]
    return _lens_balance(
        context.members,
        _role_lens_definition(context, AssignmentRole.primary),
        history_days,
        horizon_days,
    )


def test_one_range_levels_at_most_half_a_share_and_keeps_the_order() -> None:
    balance = _balance(_year_of_debt(), NAMES)
    for name in NAMES:
        allowance = REPAYMENT_SHARE * balance.horizon_share[name]
        assert abs(balance.repayable[name]) <= allowance + 1e-9, name
    creditor_allowance = REPAYMENT_SHARE * balance.horizon_share[CREDITOR]
    debtor_allowance = REPAYMENT_SHARE * balance.horizon_share[DEBTOR]
    assert balance.repayable[CREDITOR] == pytest.approx(creditor_allowance)
    assert balance.repayable[DEBTOR] == pytest.approx(-debtor_allowance)
    assert sum(balance.repayable.values()) == pytest.approx(0.0)
    for name in NAMES:
        unpaid = balance.inherited[name] - balance.repayable[name]
        assert abs(unpaid) <= abs(balance.inherited[name]) + 1e-9
    assert balance.inherited[CREDITOR] == pytest.approx(40.0)
    assert balance.inherited[DEBTOR] == pytest.approx(-40.0)


def test_one_person_over_share_among_many_under_it_still_keeps_half_a_share() -> None:
    """Clamped one by one, seven people at minus two shares would together
    claim far more than the one person over share may give up, and the
    levelling would push that person to nothing. The conserving shift spreads
    the shortfall instead."""
    points = {(name, AssignmentRole.primary): 40.0 for name in NAMES}
    points[(CREDITOR, AssignmentRole.primary)] = 40.0 + 7 * 10.0
    balance = _balance(points, NAMES)
    allowance = REPAYMENT_SHARE * balance.horizon_share[CREDITOR]
    assert balance.repayable[CREDITOR] == pytest.approx(allowance)
    for name in NAMES[1:]:
        assert balance.repayable[name] == pytest.approx(-allowance / 7)
    assert sum(balance.repayable.values()) == pytest.approx(0.0)


def test_a_newcomer_has_no_debt_and_no_repayment() -> None:
    newcomer = "Nowa"
    points = {(name, AssignmentRole.primary): 40.0 for name in NAMES}
    context_names = [*NAMES, newcomer]
    members = [_member(name) for name in NAMES] + [_member(newcomer, STARTS)]
    context = _ModelBuildContext(
        starts_on=STARTS,
        ends_on=ENDS,
        mode=RotationMode.hybrid,
        members=members,
        historical_points=points,
        holidays=HOLIDAYS,
        historical_lenses={},
        history_window=HISTORY_WINDOW,
        fairness_weight=3.0,
        continuity_weight=1.0,
        preference_weight=2.0,
        late_shift_anchor=LateShiftAnchor.secondary,
    )
    history_days = [
        HISTORY_WINDOW[0] + timedelta(days=offset)
        for offset in range((HISTORY_WINDOW[1] - HISTORY_WINDOW[0]).days + 1)
    ]
    horizon_days = [STARTS + timedelta(days=offset) for offset in range((ENDS - STARTS).days + 1)]
    balance = _lens_balance(
        members, _role_lens_definition(context, AssignmentRole.primary), history_days, horizon_days
    )
    assert set(balance.inherited) == set(context_names)
    assert balance.inherited[newcomer] == pytest.approx(0.0)
    assert balance.repayable[newcomer] == pytest.approx(0.0)
    assert balance.horizon_share[newcomer] == pytest.approx(balance.horizon_share[NAMES[0]])


# --- the warning, in every shape it can take ---------------------------------


def _lens(label: str, history_spread: float) -> _Lens:
    return _Lens(label, (), 0, 1, 0, 0, True, (), history_spread=history_spread)


def test_the_warning_blames_history_only_when_history_already_broke_the_criterion() -> None:
    inherited = [_lens("primary", 60.0), _lens("secondary", 2.0)]
    spreads = {"primary": 500, "secondary": 20}
    named = _criterion_warning(inherited, spreads, 45)
    assert named.startswith("Zastany dług historyczny")
    assert "najniższa osiągalna rozpiętość to 45 punktów" in named
    assert "połowę jej udziału" in named

    paced = _criterion_warning(inherited, spreads, ACCEPTANCE_POINTS)
    assert paced.startswith("Zastany dług historyczny")
    assert "byłoby osiągalne" in paced
    assert "Kolejny zakres dokończy wyrównanie" in paced

    starved = _criterion_warning(inherited, spreads, None)
    assert starved.startswith("Zastany dług historyczny")
    assert "nie udało się wyznaczyć" in starved

    roster = [_lens("primary", 1.0), _lens("secondary", 2.0)]
    assert "obsadzie" in _criterion_warning(roster, {"primary": 50, "secondary": 20}, 5)
    assert "dłuższy budżet" in _criterion_warning(
        roster, {"primary": 50, "secondary": 20}, ACCEPTANCE_POINTS
    )
    assert "nie udało się wyznaczyć" in _criterion_warning(
        roster, {"primary": 50, "secondary": 20}, None
    )
    # A lens history broke and a lens the draft broke: not inherited.
    mixed = _criterion_warning(inherited, {"primary": 500, "secondary": 40}, 45)
    assert not mixed.startswith("Zastany dług")


# --- consecutive ranges: the debt shrinks every time, nobody sits out --------

ROLLOUT_NAMES = ["Wierzyciel", "Dłużnik", "Anna", "Bartek", "Cezary", "Dora"]
ROLLOUT_STARTS = date(2026, 10, 5)  # a Monday
RANGE_DAYS = 28
RANGES = 4


def _unfair_half_year() -> list[tuple[date, AssignmentRole, str]]:
    """Six months where one person held every other PRIMARY and another every
    other SECONDARY, the remaining four sharing the rest."""
    others = ROLLOUT_NAMES[2:]
    duties: list[tuple[date, AssignmentRole, str]] = []
    first = ROLLOUT_STARTS - timedelta(days=180)
    holidays = polish_holidays(first, ROLLOUT_STARTS)
    for offset in range(180):
        day = first + timedelta(days=offset)
        if offset % 2 == 0:
            primary, secondary = ROLLOUT_NAMES[0], ROLLOUT_NAMES[1]
        else:
            primary = others[offset % 4]
            secondary = others[(offset + 1) % 4]
        duties.append((day, AssignmentRole.primary, primary))
        duties.append((day, AssignmentRole.secondary, secondary))
        if day.weekday() < 5 and day not in holidays:
            duties.append((day, AssignmentRole.late_shift, secondary))
    return duties


def _history(
    duties: list[tuple[date, AssignmentRole, str]], window: tuple[date, date], holidays: set[date]
) -> tuple[dict[tuple[str, AssignmentRole], float], dict[tuple[str, str], float]]:
    """The same points and lenses the duty-history adapter feeds the solver."""
    points: dict[tuple[str, AssignmentRole], float] = defaultdict(float)
    lenses: dict[tuple[str, str], float] = defaultdict(float)
    for day, role, name in duties:
        if not window[0] <= day <= window[1]:
            continue
        if role in ONCALL:
            points[(name, role)] += day_weight(day, holidays)
            if day.weekday() >= 5:
                lenses[(name, "weekends")] += 1.0
            elif day in holidays:
                lenses[(name, "holidays")] += 1.0
        else:
            points[(name, role)] += 1.0
    return dict(points), dict(lenses)


def _window_spread(
    duties: list[tuple[date, AssignmentRole, str]], as_of: date, role: AssignmentRole
) -> float:
    """The report's spread on one lens: everybody is eligible throughout, so
    the fair share is the plain mean."""
    window = (as_of - timedelta(days=365), as_of)
    holidays = polish_holidays(*window)
    points, _lenses = _history(duties, window, holidays)
    per_person = [points.get((name, role), 0.0) for name in ROLLOUT_NAMES]
    return max(per_person) - min(per_person)


def test_consecutive_ranges_pay_the_debt_down_without_all_or_nothing_months() -> None:
    duties = _unfair_half_year()
    members = [_member(name) for name in ROLLOUT_NAMES]
    spreads = {
        role: [_window_spread(duties, ROLLOUT_STARTS - timedelta(days=1), role)] for role in ONCALL
    }
    assert min(spreads[role][0] for role in ONCALL) > 20 * ACCEPTANCE_POINTS

    for index in range(RANGES):
        starts = ROLLOUT_STARTS + timedelta(days=RANGE_DAYS * index)
        ends = starts + timedelta(days=RANGE_DAYS - 1)
        window = generator_history_window(starts, ends)
        holidays = polish_holidays(window[0], ends)
        points, lenses = _history(duties, window, holidays)
        prior: dict[str, set[date]] = defaultdict(set)
        for day, role, name in duties:
            if role in ONCALL and starts - timedelta(days=6) <= day < starts:
                prior[name].add(day)
        result = generate_schedule(
            starts_on=starts,
            ends_on=ends,
            mode=RotationMode.hybrid,
            members=members,
            historical_points=points,
            holidays=holidays,
            historical_lenses=lenses,
            prior_oncall=dict(prior),
            history_window=window,
            solve_seconds=BUDGET,
        )
        assert result.conflicts == (), (index, result.conflicts)

        held = _duties(result)
        for name in ROLLOUT_NAMES:
            assert held[name][AssignmentRole.primary] >= 1, (index, name, held[name])
            assert held[name][AssignmentRole.secondary] >= 1, (index, name, held[name])
        _assert_bounded_shares(result, ROLLOUT_NAMES, holidays, index)

        duties.extend(
            (item.service_date, item.role, item.assignee_name) for item in result.assignments
        )
        for role in ONCALL:
            spreads[role].append(_window_spread(duties, ends, role))

    for role in ONCALL:
        trajectory = spreads[role]
        # Every range repays some of the debt and none of them reopens it: no
        # more all-or-nothing months followed by a swing back.
        for before, after in pairwise(trajectory):
            assert after <= before - 2, (role, trajectory)
