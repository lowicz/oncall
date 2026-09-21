from datetime import date, timedelta

from ortools.sat.python import cp_model

from oncall.domain.vocabulary import AssignmentRole, AvailabilityKind, LateShiftAnchor, RotationMode
from oncall.scheduler import (
    TIE_BREAK_FRACTION,
    DateRange,
    PreferenceRange,
    SolverMember,
    SolverResult,
    _build_model,
    generate_schedule,
)


def member(name: str, preferences: tuple[PreferenceRange, ...] = ()) -> SolverMember:
    active = DateRange(date(2026, 1, 1), None)
    return SolverMember(
        name=name,
        active=active,
        eligibility={role: (active,) for role in AssignmentRole},
        preferences=preferences,
    )


def test_generator_covers_roles_and_keeps_primary_secondary_distinct() -> None:
    result = generate_schedule(
        starts_on=date(2026, 9, 7),
        ends_on=date(2026, 9, 8),
        mode=RotationMode.hybrid,
        members=[member("Anna"), member("Marek"), member("Ola")],
        historical_points={},
        holidays=set(),
    )

    assert result.conflicts == ()
    assert result.status in {"OPTIMAL", "FEASIBLE"}
    assert len(result.assignments) == 6
    for day in (date(2026, 9, 7), date(2026, 9, 8)):
        current = [item for item in result.assignments if item.service_date == day]
        primary = next(item for item in current if item.role == AssignmentRole.primary)
        secondary = next(item for item in current if item.role == AssignmentRole.secondary)
        assert primary.assignee_name != secondary.assignee_name


def test_unavailable_is_hard_constraint() -> None:
    blocked = PreferenceRange(date(2026, 9, 7), date(2026, 9, 7), AvailabilityKind.unavailable)
    result = generate_schedule(
        starts_on=date(2026, 9, 7),
        ends_on=date(2026, 9, 7),
        mode=RotationMode.daily,
        members=[member("Anna", (blocked,)), member("Marek"), member("Ola")],
        historical_points={},
        holidays=set(),
    )

    assert all(item.assignee_name != "Anna" for item in result.assignments)


def test_weekly_mode_prefers_continuity() -> None:
    result = generate_schedule(
        starts_on=date(2026, 9, 7),
        ends_on=date(2026, 9, 11),
        mode=RotationMode.weekly,
        members=[member("Anna"), member("Marek"), member("Ola")],
        historical_points={},
        holidays=set(),
        continuity_weight=100,
    )

    primary_names = {
        item.assignee_name for item in result.assignments if item.role == AssignmentRole.primary
    }
    # A4 first proves and freezes the fairness optimum, independently of the
    # continuity slider. Five duties across three equally exposed people need
    # all three holders; phase two then minimizes handovers within that optimum.
    assert len(primary_names) == 3


def test_hybrid_mode_limits_consecutive_oncall_nights() -> None:
    result = generate_schedule(
        starts_on=date(2026, 9, 7),
        ends_on=date(2026, 9, 20),
        mode=RotationMode.hybrid,
        members=[member("Anna"), member("Marek"), member("Ola")],
        historical_points={},
        holidays=set(),
    )

    by_name = {
        name: {
            item.service_date
            for item in result.assignments
            if item.assignee_name == name
            and item.role in (AssignmentRole.primary, AssignmentRole.secondary)
        }
        for name in ("Anna", "Marek", "Ola")
    }
    for duties in by_name.values():
        for start in (date(2026, 9, 7) + timedelta(days=index) for index in range(11)):
            assert sum(start + timedelta(days=offset) in duties for offset in range(4)) <= 3


def test_daily_spacing_limits_every_seven_day_window_and_requires_two_day_rest() -> None:
    start = date(2026, 9, 7)
    names = [f"Osoba {index}" for index in range(6)]
    result = generate_schedule(
        starts_on=start,
        ends_on=start + timedelta(days=27),
        mode=RotationMode.daily,
        members=[member(name) for name in names],
        historical_points={},
        holidays=set(),
    )

    assert result.conflicts == ()
    assert result.warnings == ()
    for name in names:
        duties = {
            item.service_date
            for item in result.assignments
            if item.assignee_name == name
            and item.role in (AssignmentRole.primary, AssignmentRole.secondary)
        }
        for offset in range(22):
            assert sum(start + timedelta(days=offset + day) in duties for day in range(7)) <= 3
        for offset in range(25):
            pattern = [start + timedelta(days=offset + day) in duties for day in range(4)]
            assert pattern != [True, True, False, True]


def test_weekly_mode_does_not_enable_daily_spacing_rules() -> None:
    start = date(2026, 9, 7)
    result = generate_schedule(
        starts_on=start,
        ends_on=start + timedelta(days=6),
        mode=RotationMode.weekly,
        members=[member("Anna"), member("Marek"), member("Ola")],
        historical_points={},
        holidays=set(),
    )

    counts = {
        name: sum(
            item.assignee_name == name
            and item.role in (AssignmentRole.primary, AssignmentRole.secondary)
            for item in result.assignments
        )
        for name in ("Anna", "Marek", "Ola")
    }
    assert max(counts.values()) > 3
    assert result.warnings == ()


def test_infeasible_spacing_is_retried_with_an_explicit_warning() -> None:
    start = date(2026, 9, 7)
    result = generate_schedule(
        starts_on=start,
        ends_on=start + timedelta(days=6),
        mode=RotationMode.daily,
        members=[member(name) for name in ("Anna", "Marek", "Ola", "Piotr")],
        historical_points={},
        holidays=set(),
    )

    assert result.conflicts == ()
    assert len(result.assignments) == 19
    assert len(result.warnings) == 1
    assert "musiały zostać zawieszone" in result.warnings[0]


def test_spacing_is_feasible_at_monday_and_saturday_range_boundaries() -> None:
    for start in (date(2026, 9, 7), date(2026, 9, 12)):
        result = generate_schedule(
            starts_on=start,
            ends_on=start + timedelta(days=6),
            mode=RotationMode.hybrid,
            members=[member(f"Osoba {index}") for index in range(6)],
            historical_points={},
            holidays=set(),
        )
        assert result.conflicts == (), start
        assert result.warnings == (), start


def test_reports_missing_coverage() -> None:
    result = generate_schedule(
        starts_on=date(2026, 9, 7),
        ends_on=date(2026, 9, 7),
        mode=RotationMode.hybrid,
        members=[],
        historical_points={},
        holidays=set(),
    )

    assert len(result.conflicts) == 3
    assert result.status == "INFEASIBLE"
    assert result.failure_reason == "PRECHECK"


def test_solver_infeasibility_names_hard_rule_families() -> None:
    result = generate_schedule(
        starts_on=date(2026, 9, 7),
        ends_on=date(2026, 9, 10),
        mode=RotationMode.daily,
        members=[member("Anna"), member("Marek")],
        historical_points={},
        holidays=set(),
    )

    assert result.status == "INFEASIBLE"
    assert result.failure_reason == "INFEASIBLE"
    assert "limit" in result.conflicts[0]
    assert "Model CP-SAT nie znalazł" not in result.conflicts[0]


def test_unknown_reports_time_budget_instead_of_a_rule_conflict() -> None:
    result = generate_schedule(
        starts_on=date(2026, 9, 7),
        ends_on=date(2026, 12, 6),
        mode=RotationMode.hybrid,
        members=[member(f"Osoba {index}") for index in range(10)],
        historical_points={},
        holidays=set(),
        solve_seconds=0.000001,
    )

    assert result.status == "UNKNOWN"
    assert result.failure_reason == "UNKNOWN"
    assert "nie zdążył" in result.conflicts[0]
    # The message names the whole-run ceiling (4 x the per-pass budget), which
    # is what the coordinator actually waited (HGH6-02).
    assert "0.000004 s" in result.conflicts[0]


def test_historical_imbalance_affects_global_solution() -> None:
    result = generate_schedule(
        starts_on=date(2026, 9, 7),
        ends_on=date(2026, 9, 7),
        mode=RotationMode.daily,
        members=[member("Anna"), member("Marek"), member("Ola")],
        historical_points={("Anna", AssignmentRole.primary): 20},
        holidays=set(),
    )

    primary = next(item for item in result.assignments if item.role == AssignmentRole.primary)
    assert primary.assignee_name != "Anna"


def test_late_shift_is_generated_only_on_working_days() -> None:
    result = generate_schedule(
        starts_on=date(2026, 9, 12),
        ends_on=date(2026, 9, 14),
        mode=RotationMode.daily,
        members=[member("Anna"), member("Marek"), member("Ola")],
        historical_points={},
        holidays=set(),
    )

    late_days = {
        item.service_date for item in result.assignments if item.role == AssignmentRole.late_shift
    }
    assert late_days == {date(2026, 9, 14)}


def test_new_joiner_does_not_inherit_debt_from_before_eligibility() -> None:
    new_active = DateRange(date(2026, 9, 7), None)
    newcomer = SolverMember(
        name="Nowa",
        active=new_active,
        eligibility={role: (new_active,) for role in AssignmentRole},
    )
    result = generate_schedule(
        starts_on=date(2026, 9, 7),
        ends_on=date(2026, 9, 15),
        mode=RotationMode.daily,
        members=[member(f"Osoba {index}") for index in range(8)] + [newcomer],
        historical_points={(f"Osoba {index}", AssignmentRole.primary): 45 for index in range(8)},
        holidays=set(),
    )

    newcomer_primary = [
        item
        for item in result.assignments
        if item.role == AssignmentRole.primary and item.assignee_name == "Nowa"
    ]
    assert len(newcomer_primary) <= 2


def test_late_shift_can_follow_primary() -> None:
    result = generate_schedule(
        starts_on=date(2026, 9, 7),
        ends_on=date(2026, 9, 7),
        mode=RotationMode.daily,
        members=[member("Anna"), member("Marek"), member("Ola")],
        historical_points={},
        holidays=set(),
        late_shift_anchor=LateShiftAnchor.primary,
    )

    primary = next(item for item in result.assignments if item.role == AssignmentRole.primary)
    late = next(item for item in result.assignments if item.role == AssignmentRole.late_shift)
    assert late.assignee_name == primary.assignee_name


def test_late_shift_hard_follows_secondary_for_every_fully_eligible_member() -> None:
    result = generate_schedule(
        starts_on=date(2026, 9, 7),
        ends_on=date(2026, 9, 11),
        mode=RotationMode.hybrid,
        members=[member("Anna"), member("Marek"), member("Ola")],
        historical_points={},
        holidays=set(),
        late_shift_anchor=LateShiftAnchor.secondary,
    )

    assert result.conflicts == ()
    assert result.anchor_exceptions == ()
    for day in (date(2026, 9, 7) + timedelta(days=offset) for offset in range(5)):
        assert _assignee(result, day, AssignmentRole.late_shift) == _assignee(
            result, day, AssignmentRole.secondary
        )


def test_member_without_late_shift_eligibility_does_not_block_anchor() -> None:
    active = DateRange(date(2026, 1, 1), None)
    primary_and_late = {
        AssignmentRole.primary: (active,),
        AssignmentRole.late_shift: (active,),
    }
    anchor_only = SolverMember(
        name="Tylko secondary",
        active=active,
        eligibility={AssignmentRole.secondary: (active,)},
    )
    result = generate_schedule(
        starts_on=date(2026, 9, 7),
        ends_on=date(2026, 9, 7),
        mode=RotationMode.daily,
        members=[
            anchor_only,
            SolverMember("Anna", active, primary_and_late),
            SolverMember("Marek", active, primary_and_late),
        ],
        historical_points={},
        holidays=set(),
        late_shift_anchor=LateShiftAnchor.secondary,
    )

    assert result.conflicts == ()
    assert _assignee(result, date(2026, 9, 7), AssignmentRole.secondary) == "Tylko secondary"
    assert _assignee(result, date(2026, 9, 7), AssignmentRole.late_shift) != "Tylko secondary"
    assert len(result.anchor_exceptions) == 1
    assert "Tylko secondary" in result.anchor_exceptions[0]


def test_late_shift_lens_leaves_the_range_family_only_when_anchored() -> None:
    """BLK5-02 (D1): anchored, the 11-19 lens drops its range term; only
    `independent` keeps the full lens. How much of the tie-breaker survives
    depends on the measured TIE_BREAK_FRACTION - zero compiles it out."""
    active = DateRange(date(2026, 1, 1), None)
    members = [
        SolverMember(
            name=f"m{index}",
            active=active,
            eligibility={role: (active,) for role in AssignmentRole},
            preferences=(),
        )
        for index in range(6)
    ]
    for anchor in (
        LateShiftAnchor.secondary,
        LateShiftAnchor.primary,
        LateShiftAnchor.independent,
    ):
        _model, _variables, conflicts, _lenses = _build_model(
            starts_on=date(2026, 9, 1),
            ends_on=date(2026, 9, 30),
            mode=RotationMode.hybrid,
            members=members,
            historical_points={},
            holidays=set(),
            historical_lenses={},
            history_window=None,
            fairness_weight=3.0,
            continuity_weight=1.0,
            preference_weight=2.0,
            late_shift_anchor=anchor,
            spacing=False,
        )
        assert conflicts == []
        names = {variable.name for variable in _model.proto.variables}
        has_range = {"max_late_shift", "min_late_shift"} <= names
        has_spread = any(name.startswith("spread_late_shift_") for name in names)
        if anchor == LateShiftAnchor.independent:
            assert has_range and has_spread, f"brak pelnej soczewki 11-19 dla {anchor}"
        else:
            assert not has_range, f"zakotwiczona soczewka 11-19 ma czlon rozpiety dla {anchor}"
            assert has_spread == bool(TIE_BREAK_FRACTION), (
                f"czlon rozkladu 11-19 niezgodny z TIE_BREAK_FRACTION dla {anchor}"
            )


def _assignee(result: SolverResult, day: date, role: AssignmentRole) -> str:
    return next(
        item.assignee_name
        for item in result.assignments
        if item.service_date == day and item.role == role
    )


def test_weekend_is_not_split_between_people() -> None:
    """One weekend, one person per role: no handover in the middle of a rest."""
    names = [f"Osoba {index}" for index in range(6)]
    result = generate_schedule(
        starts_on=date(2026, 9, 5),
        ends_on=date(2026, 9, 13),
        mode=RotationMode.daily,
        members=[member(name) for name in names],
        historical_points={},
        holidays=set(),
    )

    assert result.conflicts == ()
    weekends = ((date(2026, 9, 5), date(2026, 9, 6)), (date(2026, 9, 12), date(2026, 9, 13)))
    for saturday, sunday in weekends:
        for role in (AssignmentRole.primary, AssignmentRole.secondary):
            assert _assignee(result, saturday, role) == _assignee(result, sunday, role), (
                role,
                saturday,
            )


def test_holiday_joins_the_adjacent_weekend_into_one_block() -> None:
    """A Friday holiday merges with its weekend: all three days stay together."""
    names = [f"Osoba {index}" for index in range(6)]
    holiday = date(2026, 9, 11)  # Friday
    result = generate_schedule(
        starts_on=date(2026, 9, 11),
        ends_on=date(2026, 9, 13),
        mode=RotationMode.daily,
        members=[member(name) for name in names],
        historical_points={},
        holidays={holiday},
    )

    assert result.conflicts == ()
    for role in (AssignmentRole.primary, AssignmentRole.secondary):
        people = {
            _assignee(result, day, role)
            for day in (date(2026, 9, 11), date(2026, 9, 12), date(2026, 9, 13))
        }
        assert len(people) == 1, role


def test_weekend_block_with_partial_unavailability_goes_to_somebody_else() -> None:
    """A person unavailable for one day of the block simply cannot take it."""
    blocked = PreferenceRange(date(2026, 9, 6), date(2026, 9, 6), AvailabilityKind.unavailable)
    result = generate_schedule(
        starts_on=date(2026, 9, 5),
        ends_on=date(2026, 9, 6),
        mode=RotationMode.daily,
        members=[member("Anna", (blocked,)), member("Marek"), member("Ola"), member("Piotr")],
        historical_points={},
        holidays=set(),
    )

    assert result.conflicts == ()
    assert len(result.assignments) == 4
    saturday, sunday = date(2026, 9, 5), date(2026, 9, 6)
    for role in (AssignmentRole.primary, AssignmentRole.secondary):
        assert _assignee(result, saturday, role) == _assignee(result, sunday, role)
        assert _assignee(result, saturday, role) != "Anna"


def test_uncoverable_weekend_block_returns_a_named_conflict() -> None:
    """When nobody can take the whole block the solver says so instead of splitting."""
    saturday = PreferenceRange(date(2026, 9, 5), date(2026, 9, 5), AvailabilityKind.unavailable)
    sunday = PreferenceRange(date(2026, 9, 6), date(2026, 9, 6), AvailabilityKind.unavailable)
    result = generate_schedule(
        starts_on=date(2026, 9, 5),
        ends_on=date(2026, 9, 6),
        mode=RotationMode.daily,
        members=[member("Anna", (saturday,)), member("Marek", (sunday,)), member("Ola")],
        historical_points={},
        holidays=set(),
    )

    assert result.status == "INFEASIBLE"
    assert any("cały blok" in conflict for conflict in result.conflicts), result.conflicts


def role_points(
    result: SolverResult,
    role: AssignmentRole,
    names: list[str],
    holidays: set[date] | None = None,
) -> list[int]:
    """Points each of `names` collects in one role, weekends and holidays at 2X."""
    points = dict.fromkeys(names, 0)
    for item in result.assignments:
        if item.role != role or item.assignee_name not in points:
            continue
        weight = (
            1
            if role == AssignmentRole.late_shift
            else day_weight(item.service_date, holidays or set())
        )
        points[item.assignee_name] += weight
    return [points[name] for name in names]


def day_weight(day: date, holidays: set[date] | None = None) -> int:
    return 2 if day.weekday() >= 5 or day in (holidays or set()) else 1


def weekend_duties(result: SolverResult, names: list[str]) -> list[int]:
    counts = dict.fromkeys(names, 0)
    for item in result.assignments:
        if item.role != AssignmentRole.late_shift and item.service_date.weekday() >= 5:
            counts[item.assignee_name] += 1
    return [counts[name] for name in names]


def test_production_hybrid_balances_a_holiday_despite_a_preference() -> None:
    """D7 fairness wins in production mode, with its anchor and a midweek holiday."""
    # Production uses ten people. With only five, the hard 3-in-7 spacing rule
    # leaves too little freedom to guarantee the independent per-role threshold.
    names = [f"Osoba {index}" for index in range(10)]
    starts_on = date(2026, 9, 7)
    ends_on = date(2026, 10, 4)
    holidays = {date(2026, 9, 16)}
    preferred = PreferenceRange(starts_on, ends_on, AvailabilityKind.prefer)
    result = generate_schedule(
        starts_on=starts_on,
        ends_on=ends_on,
        mode=RotationMode.hybrid,
        members=[member(names[0], (preferred,)), *[member(name) for name in names[1:]]],
        historical_points={},
        holidays=holidays,
        late_shift_anchor=LateShiftAnchor.secondary,
    )

    # With an anchor enabled, late_shift mirrors a role whose own fairness lens
    # also includes weekends. Its standalone distribution is informational and
    # deliberately no longer competes with the anchor lens in the objective.
    # With indivisible 2X blocks, anchored 11-19 and an active preference, a
    # three-point spread is the documented 35-day acceptance bound. Two points
    # remain the optimization target, but are not consistently attainable in
    # the 90-second budget (QA-REPORT-4, N2 decision).
    for role in (AssignmentRole.primary, AssignmentRole.secondary):
        points = role_points(result, role, names, holidays)
        assert max(points) - min(points) <= 3, (role, points)


def test_weekend_duty_is_balanced_on_its_own() -> None:
    """Equal points are not enough: one person must not absorb the weekends."""
    names = [f"Osoba {index}" for index in range(4)]
    result = generate_schedule(
        starts_on=date(2026, 9, 7),
        ends_on=date(2026, 10, 4),
        mode=RotationMode.daily,
        members=[member(name) for name in names],
        historical_points={},
        holidays=set(),
    )

    duties = weekend_duties(result, names)
    assert max(duties) - min(duties) <= 1, duties


def test_historical_weekend_surplus_is_paid_back() -> None:
    """Somebody who already worked the weekends steps back from the next ones."""
    names = [f"Osoba {index}" for index in range(4)]
    result = generate_schedule(
        starts_on=date(2026, 9, 7),
        ends_on=date(2026, 10, 4),
        mode=RotationMode.daily,
        members=[member(name) for name in names],
        historical_points={},
        holidays=set(),
        historical_lenses={("Osoba 0", "weekends"): 12.0},
    )

    duties = weekend_duties(result, names)
    assert duties[0] < min(duties[1:]), duties


def test_tie_break_spreads_duty_instead_of_piling_it_on_one_person() -> None:
    """The widest gap can be fixed and the rest still unfair; that has to be resolved.

    One person carries a large historical surplus, so they set the top of the
    range whatever happens and minimizing it only decides the lowest person.
    Everybody in between is free, and every split of the remaining duty scores
    the same - which is how the generator used to produce a 2/2/2/4 staircase
    from a fixed seed. The surplus holder still takes their bounded share of
    the range; the staircase question is about the other four.
    """
    names = ["Anna", "Marek", "Ola", "Piotr"]
    result = generate_schedule(
        starts_on=date(2026, 9, 7),
        ends_on=date(2026, 9, 18),
        mode=RotationMode.daily,
        members=[member(name) for name in [*names, "Dłużnik"]],
        historical_points={("Dłużnik", AssignmentRole.primary): 40},
        holidays=set(),
        late_shift_anchor=LateShiftAnchor.independent,
    )

    points = role_points(result, AssignmentRole.primary, names)
    assert max(points) - min(points) <= 1, points


def test_spacing_rules_are_never_assumption_gated(monkeypatch) -> None:
    """BLK-01 regression: `add_assumption` (which forces one search thread and
    weakens presolve) must not come back for the relaxation rules. Any re-added
    `add_assumption` call fails this test loudly.
    """

    def forbidden(_model, _literal):
        raise AssertionError("add_assumption must not be used")

    monkeypatch.setattr(cp_model.CpModel, "add_assumption", forbidden)
    for mode in (RotationMode.hybrid, RotationMode.daily):
        result = generate_schedule(
            starts_on=date(2026, 9, 7),
            ends_on=date(2026, 9, 20),
            mode=mode,
            members=[member(f"Osoba {index}") for index in range(10)],
            historical_points={},
            holidays=set(),
        )
        assert result.conflicts == ()
        assert result.status in {"OPTIMAL", "FEASIBLE"}


def test_solver_uses_num_workers_instead_of_deprecated_field(monkeypatch) -> None:
    """BLK-01: `num_search_workers` is gone in OR-Tools 9.15; the model must be
    parameterised through `num_workers` only, or setting a worker count makes
    CP-SAT invalidate the model.
    """
    observed = {}

    def recording_solve(self, model):
        observed["num_workers"] = self.parameters.num_workers
        observed["num_search_workers"] = self.parameters.num_search_workers
        return original_solve(self, model)

    original_solve = cp_model.CpSolver.solve
    monkeypatch.setattr(cp_model.CpSolver, "solve", recording_solve)
    result = generate_schedule(
        starts_on=date(2026, 9, 7),
        ends_on=date(2026, 9, 13),
        mode=RotationMode.hybrid,
        members=[member(f"Osoba {index}") for index in range(10)],
        historical_points={},
        holidays=set(),
        solver_workers=4,
    )
    assert result.status in {"OPTIMAL", "FEASIBLE"}
    assert observed["num_workers"] == 4
    assert observed["num_search_workers"] == 0


def test_spacing_fallback_returns_complete_draft_with_warning() -> None:
    """The fallback pass on infeasible relaxation rules must hand back a complete
    roster plus a warning, never an empty conflict-laden failure (that is what
    surfaces as a 409 in the API)."""
    start = date(2026, 9, 7)
    result = generate_schedule(
        starts_on=start,
        ends_on=start + timedelta(days=6),
        mode=RotationMode.daily,
        members=[member(name) for name in ("Anna", "Marek", "Ola", "Piotr")],
        historical_points={},
        holidays=set(),
    )

    assert result.conflicts == ()
    assert result.status in {"OPTIMAL", "FEASIBLE"}
    assert len(result.assignments) == 19
    assert len(result.warnings) == 1
    assert "musiały zostać zawieszone" in result.warnings[0]
