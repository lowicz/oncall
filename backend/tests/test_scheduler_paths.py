"""Generator paths the everyday fixtures do not reach: blocks nobody can hold,
unwilling people, runs nothing can save, the progress events and the floor
question answered at the criterion itself."""

import time
from datetime import date, timedelta

import pytest
from ortools.sat.python import cp_model

from oncall import scheduler
from oncall.domain.vocabulary import AssignmentRole, AvailabilityKind, LateShiftAnchor, RotationMode
from oncall.fairness import ACCEPTANCE_POINTS
from oncall.scheduler import (
    MODEL_BUILT,
    SOLVE_DONE,
    SOLVE_PASS,
    DateRange,
    PreferenceRange,
    SolverMember,
    _build_model_from_context,
    _ModelBuildContext,
    date_ranges,
    generate_schedule,
)

MONDAY = date(2026, 9, 7)
SATURDAY = date(2026, 9, 12)
SUNDAY = date(2026, 9, 13)


def _member(name: str, *away: date, kind: AvailabilityKind = AvailabilityKind.unavailable):
    active = DateRange(date(2025, 1, 1), None)
    return SolverMember(
        name=name,
        active=active,
        eligibility={role: (active,) for role in AssignmentRole},
        preferences=tuple(PreferenceRange(day, day, kind) for day in away),
    )


def test_consecutive_days_read_as_ranges() -> None:
    assert date_ranges([]) == ""
    assert date_ranges([MONDAY + timedelta(days=4), MONDAY, MONDAY + timedelta(days=1)]) == (
        "2026-09-07 - 2026-09-08, 2026-09-11"
    )


def test_a_weekend_nobody_can_hold_whole_is_a_precheck_conflict() -> None:
    result = generate_schedule(
        starts_on=SATURDAY,
        ends_on=SUNDAY,
        mode=RotationMode.hybrid,
        members=[_member("Anna", SATURDAY), _member("Bartek", SUNDAY), _member("Ola", SATURDAY)],
        historical_points={},
        holidays=set(),
        solve_seconds=2,
    )

    assert (result.status, result.failure_reason, result.assignments) == (
        "INFEASIBLE",
        "PRECHECK",
        (),
    )
    assert [item for item in result.conflicts if "cały blok" in item] == [
        f"2026-09-12 - 2026-09-13: brak osoby, która może objąć cały blok jako {role}"
        for role in (
            scheduler.ROLE_LABELS[AssignmentRole.primary],
            scheduler.ROLE_LABELS[AssignmentRole.secondary],
        )
    ]


def test_a_long_block_holder_rests_on_both_sides_even_beside_an_absence() -> None:
    """Christmas 2025 is a five-day block (24th to 28th). Its holders rest on
    the 23rd and the 29th; somebody away on the 23rd has no duty there to
    forbid, and the rule simply does not apply to them on that side."""
    holidays = {date(2025, 12, 24), date(2025, 12, 25), date(2025, 12, 26)}
    before, after = date(2025, 12, 23), date(2025, 12, 29)
    names = ["Anna", "Bartek", "Celina", "Dawid", "Ela"]
    result = generate_schedule(
        starts_on=date(2025, 12, 22),
        ends_on=date(2025, 12, 30),
        mode=RotationMode.hybrid,
        members=[_member(names[0], before)] + [_member(name) for name in names[1:]],
        historical_points={},
        holidays=holidays,
        solve_seconds=5,
    )

    assert result.status in {"OPTIMAL", "FEASIBLE"}, result.conflicts
    oncall = [item for item in result.assignments if item.role != AssignmentRole.late_shift]
    block_holders = {
        item.assignee_name
        for item in oncall
        if date(2025, 12, 24) <= item.service_date and item.service_date <= date(2025, 12, 28)
    }
    assert block_holders
    beside = {item.assignee_name for item in oncall if item.service_date in (before, after)}
    assert not block_holders & beside
    assert "Anna" not in {item.assignee_name for item in oncall if item.service_date == before}


def test_somebody_who_prefers_not_to_serve_is_left_out_when_others_can() -> None:
    result = generate_schedule(
        starts_on=MONDAY,
        ends_on=MONDAY,
        mode=RotationMode.daily,
        members=[
            _member("Anna"),
            _member("Bartek"),
            _member("Ola", MONDAY, kind=AvailabilityKind.prefer_not),
        ],
        historical_points={},
        holidays=set(),
        solve_seconds=2,
    )

    assert result.status in {"OPTIMAL", "FEASIBLE"}
    assert {item.assignee_name for item in result.assignments} == {"Anna", "Bartek"}


def test_an_empty_history_window_gives_nobody_an_inherited_share() -> None:
    """A window ending before it starts covers no day: every expected share
    from history is zero and the run is scored on the range alone."""
    result = generate_schedule(
        starts_on=MONDAY,
        ends_on=MONDAY + timedelta(days=6),
        mode=RotationMode.hybrid,
        members=[_member(name) for name in ("Anna", "Bartek", "Celina", "Dawid")],
        historical_points={("Anna", AssignmentRole.primary): 5.0},
        holidays=set(),
        history_window=(MONDAY, MONDAY - timedelta(days=1)),
        solve_seconds=5,
    )

    assert result.status in {"OPTIMAL", "FEASIBLE"}
    assert len(result.assignments) == 7 * 2 + 5


@pytest.mark.parametrize("mode", [RotationMode.hybrid, RotationMode.weekly])
def test_one_person_cannot_hold_both_on_call_roles_whatever_is_relaxed(mode) -> None:
    """Every rung of the infeasibility ladder fails: with the rest rules
    (hybrid) and without them from the start (weekly)."""
    result = generate_schedule(
        starts_on=MONDAY,
        ends_on=MONDAY,
        mode=mode,
        members=[_member("Anna")],
        historical_points={},
        holidays=set(),
        solve_seconds=2,
    )

    assert (result.status, result.failure_reason, result.assignments) == (
        "INFEASIBLE",
        "INFEASIBLE",
        (),
    )
    assert result.warnings == ()


def test_the_run_reports_each_phase_to_its_progress_callback() -> None:
    events: list[str] = []

    result = generate_schedule(
        starts_on=MONDAY,
        ends_on=MONDAY + timedelta(days=1),
        mode=RotationMode.hybrid,
        members=[_member("Anna"), _member("Bartek"), _member("Ola")],
        historical_points={},
        holidays=set(),
        solve_seconds=2,
        progress_callback=events.append,
    )

    assert result.status in {"OPTIMAL", "FEASIBLE"}
    assert events[0] == MODEL_BUILT
    assert events[-1] == SOLVE_DONE
    passes = events[1:-1]
    assert passes
    # One event per solver pass, carrying that pass's budget in seconds.
    for item in passes:
        name, budget = item.split()
        assert name == SOLVE_PASS
        assert 0 < float(budget) <= 2


def test_the_anchored_late_shift_tie_breaker_compiles_in_once_priced(monkeypatch) -> None:
    """The measured price is zero; the knob is kept for a re-measurement, and
    a non-zero price puts the anchored 11-19 distribution into the model."""
    monkeypatch.setattr(scheduler, "TIE_BREAK_FRACTION", 0.25)
    active = DateRange(date(2026, 1, 1), None)
    members = [
        SolverMember(
            name=f"m{index}",
            active=active,
            eligibility={role: (active,) for role in AssignmentRole},
            preferences=(),
        )
        for index in range(4)
    ]

    model, _variables, conflicts, _lenses = _build_model_from_context(
        _ModelBuildContext(
            starts_on=MONDAY,
            ends_on=MONDAY,
            mode=RotationMode.hybrid,
            members=members,
            historical_points={},
            holidays=set(),
            historical_lenses={},
            history_window=None,
            fairness_weight=3.0,
            continuity_weight=1.0,
            preference_weight=2.0,
            late_shift_anchor=LateShiftAnchor.secondary,
        ),
        spacing=False,
    )

    assert conflicts == []
    names = {variable.name for variable in model.proto.variables}
    assert any(name.startswith("spread_late_shift_") for name in names)
    assert not {"max_late_shift", "min_late_shift"} & names


# --- scripted solver: the order of the passes, not the search -----------------

#: Small enough that the range could level it within the criterion, large
#: enough that paced repayment leaves the 12-month window over it.
SMALL_DEBT = {("Osoba 0", AssignmentRole.primary): 10.0}


def _scripted(monkeypatch, statuses: list, *, pause: float = 0.0) -> list[bool]:
    """Hand back `statuses` in turn (then FEASIBLE), with every duty unset."""
    probes: list[bool] = []

    def solve(self, _model):
        probes.append(self.parameters.stop_after_first_solution)
        if pause:
            time.sleep(min(self.parameters.max_time_in_seconds, pause))
        return statuses.pop(0) if statuses else cp_model.FEASIBLE

    monkeypatch.setattr(cp_model.CpSolver, "solve", solve)
    monkeypatch.setattr(cp_model.CpSolver, "boolean_value", lambda self, _v: False)
    monkeypatch.setattr(cp_model.CpSolver, "value", lambda self, _v: 0)
    return probes


def _six(**overrides):
    arguments = {
        "starts_on": MONDAY,
        "ends_on": MONDAY + timedelta(days=13),
        "mode": RotationMode.hybrid,
        "members": [_member(f"Osoba {index}") for index in range(6)],
        "historical_points": SMALL_DEBT,
        "holidays": set(),
        "solve_seconds": 5,
    }
    return generate_schedule(**(arguments | overrides))


def test_a_criterion_reachable_in_the_range_is_named_as_such(monkeypatch) -> None:
    probes = _scripted(monkeypatch, [cp_model.FEASIBLE, cp_model.FEASIBLE])

    result = _six()

    # One real solve, then a single feasibility probe at the criterion.
    assert probes == [False, True]
    assert result.acceptance_floor is None
    assert any("byłoby osiągalne" in item for item in result.warnings), result.warnings


def test_no_floor_is_claimed_once_the_budget_is_spent(monkeypatch) -> None:
    probes = _scripted(monkeypatch, [cp_model.FEASIBLE], pause=1.0)

    result = _six(solve_seconds=0.8)

    assert probes == [False]
    assert result.acceptance_floor is None
    assert any("nie udało się wyznaczyć" in item for item in result.warnings), result.warnings


def test_spacing_suspended_when_only_dropping_it_and_the_cap_together_helps(
    monkeypatch,
) -> None:
    _scripted(
        monkeypatch,
        [cp_model.INFEASIBLE, cp_model.INFEASIBLE, cp_model.INFEASIBLE, cp_model.FEASIBLE],
    )

    result = _six(historical_points={})

    assert result.status == "FEASIBLE"
    assert any("rozrzedzania musiały zostać zawieszone" in item for item in result.warnings)
    assert ACCEPTANCE_POINTS > 0


# --- safety nets: checks the model itself should never trip ---------------------


def _coupling_context(member: SolverMember) -> scheduler._ModelBuildContext:
    return scheduler._ModelBuildContext(
        starts_on=MONDAY,
        ends_on=MONDAY,
        mode=RotationMode.hybrid,
        members=[member],
        historical_points={},
        holidays=set(),
        historical_lenses=None,
        history_window=None,
        fairness_weight=3.0,
        continuity_weight=1.0,
        preference_weight=2.0,
        late_shift_anchor=LateShiftAnchor.secondary,
    )


@pytest.mark.parametrize("present", [AssignmentRole.secondary, AssignmentRole.late_shift])
def test_an_anchor_pair_missing_one_half_forces_the_other_off(present) -> None:
    """Eligible for both halves of the anchored pair on a working day, a
    member with only one of the two variables must not hold that one: a
    missing half means hard unavailability, and 11-19 travels with its anchor."""
    model = cp_model.CpModel()
    variable = model.new_bool_var("lonely")
    coverage = scheduler._CoverageModel(model, [MONDAY], {(0, present, 0): variable}, [], [])

    coupling = scheduler._add_late_shift_coupling(_coupling_context(_member("Anna")), coverage)
    model.maximize(variable)
    solver = cp_model.CpSolver()
    status = solver.solve(model)

    assert coupling.anchor_role == AssignmentRole.secondary
    assert coupling.preference_terms == ()
    assert status == cp_model.OPTIMAL
    assert solver.boolean_value(variable) is False


def _conflicts_on(monkeypatch, when) -> list[dict]:
    """Make every `build()` whose keyword arguments satisfy `when` report a
    coverage conflict, as a later model would if its inputs could disagree
    with the first one; record the arguments of every build."""
    real = scheduler._build_model_from_context
    calls: list[dict] = []

    def build(context, **options):
        calls.append(options)
        model, variables, conflicts, lenses = real(context, **options)
        if when(options):
            return model, variables, ["wymuszony konflikt"], []
        return model, variables, conflicts, lenses

    monkeypatch.setattr(scheduler, "_build_model_from_context", build)
    return calls


def test_a_criterion_pass_whose_fairness_model_conflicts_is_skipped(monkeypatch) -> None:
    calls = _conflicts_on(monkeypatch, lambda options: options["fairness_only"])
    probes = _scripted(monkeypatch, [cp_model.FEASIBLE])

    result = _six(historical_points={}, solve_seconds=10)

    # The fairness-only model was built, never solved: one solve, the real one.
    assert [call["fairness_only"] for call in calls] == [False, True]
    assert probes == [False]
    assert result.status == "FEASIBLE"
    assert result.fairness_proven is False


def test_a_relaxed_spacing_model_that_conflicts_is_not_solved(monkeypatch) -> None:
    calls = _conflicts_on(
        monkeypatch,
        lambda options: not options["spacing"] and options["acceptance_cap"] == ACCEPTANCE_POINTS,
    )
    probes = _scripted(monkeypatch, [cp_model.INFEASIBLE, cp_model.FEASIBLE])

    result = _six(historical_points={})

    # The capped run fails, the relaxed probe is built but skipped, and the
    # uncapped run with the spacing rules kept is the one that succeeds.
    assert [(call["spacing"], call["acceptance_cap"]) for call in calls] == [
        (True, ACCEPTANCE_POINTS),
        (False, ACCEPTANCE_POINTS),
        (True, None),
    ]
    assert probes == [False, False]
    assert result.status == "FEASIBLE"
    assert result.warnings == ()


def test_a_floor_probe_whose_model_conflicts_counts_as_unreachable(monkeypatch) -> None:
    calls = _conflicts_on(monkeypatch, lambda options: options["window_cap"] is not None)
    probes = _scripted(monkeypatch, [cp_model.FEASIBLE])

    result = _six()

    caps = [call["window_cap"] for call in calls if call["window_cap"] is not None]
    # Every probe was refused before any solve: the floor bisects up to the
    # spread the run itself achieved, and no feasibility probe ever ran.
    assert caps[0] == ACCEPTANCE_POINTS
    assert probes == [False]
    assert result.acceptance_floor == caps[-1] + 1
    assert result.acceptance_floor > ACCEPTANCE_POINTS
    assert any("najniższa osiągalna rozpiętość to" in item for item in result.warnings)


def test_a_duty_read_back_for_an_unavailable_person_fails_the_run(monkeypatch) -> None:
    members = [_member("Anna", MONDAY), _member("Bartek"), _member("Ola")]
    monkeypatch.setattr(
        scheduler,
        "_solution_assignments",
        lambda *_args: [scheduler.GeneratedAssignment(MONDAY, AssignmentRole.primary, "Anna")],
    )

    result = generate_schedule(
        starts_on=MONDAY,
        ends_on=MONDAY,
        mode=RotationMode.daily,
        members=members,
        historical_points={},
        holidays=set(),
        solve_seconds=2,
    )

    assert (result.status, result.failure_reason, result.assignments) == (
        "INFEASIBLE",
        "INFEASIBLE",
        (),
    )
    assert result.conflicts == (
        "2026-09-07 · primary: przypisano osobę z twardą niedostępnością (Anna)",
    )
