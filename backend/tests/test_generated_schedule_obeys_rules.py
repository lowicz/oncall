"""Every generated schedule is re-checked by the pure rule evaluator (item 7).

The solver states the hard rules as CP-SAT constraints and `oncall.rules`
states them again as functions over a finished roster. Both statements are
used in production - the solver to build, the evaluator to warn at publication
and to block swaps - and nothing forced them to agree. This module does.

A generated schedule is fed back through the evaluator, and the only
violations tolerated are the ones the solver deliberately did not compile.
That waiver list is the reconciliation between the two statements, so each
entry says which constraint is missing and why:

* `weekly` rotation compiles **no** rest rule at all (`scheduler.py` gates
  `max_consecutive` and the spacing rules on `mode != weekly`), because one
  person holding a whole week is what weekly rotation means. The evaluator is
  told the mode and suspends the same three, so this needs no waiver: the two
  statements agree instead of being excused from each other.
* A run that announced suspended spacing dropped `three_in_seven` and
  `rest_after_run` to find any solution at all. `max_consecutive` is gated
  separately and stays in force even then, so it is never waived here.
* Long day-off blocks cannot be split, so their holder is exempt from the
  rolling windows. The exemption is passed into the evaluator exactly as
  `planning.py` passes it, or the violations would be an artifact of the call.

Anchor mismatches are not waived but reconciled: the solver reports them as
`anchor_exceptions` and the evaluator finds them independently, so the two
lists must name the same days.
"""

from datetime import date, timedelta

import pytest

from oncall.domain.scheduling.solver import SolverResult
from oncall.models import AssignmentRole, LateShiftAnchor, RotationMode
from oncall.rules import (
    ONCALL_ROLES,
    RuleViolation,
    Slots,
    anchor_violations,
    day_off_block_violations,
    exempt_days,
    late_shift_on_day_off,
    oncall_rest_violations,
)
from oncall.scheduler import DateRange, SolverMember, generate_schedule
from oncall.workdays import polish_holidays

STARTS = date(2026, 11, 2)
ENDS = date(2026, 11, 15)
HOLIDAYS = polish_holidays(STARTS - timedelta(days=365), ENDS)

#: Ten seconds keeps the two-pass shape - `_criterion_pass` skips itself below
#: that - while staying short enough for the ordinary suite.
BUDGET = 10.0

SPACING_RULES = {"three_in_seven", "rest_after_run"}
SUSPENDED_SPACING = "Reguły rozrzedzania"


def _member(name: str, *, late_shift: bool = True) -> SolverMember:
    active = DateRange(date(2025, 1, 1), None)
    roles = [role for role in AssignmentRole if late_shift or role != AssignmentRole.late_shift]
    return SolverMember(
        name=name,
        active=active,
        eligibility={role: (active,) for role in roles},
        preferences=(),
    )


#: Five people over this horizon cannot satisfy the rolling windows: two
#: on-call roles a day is 28 duties, and `three_in_seven` caps each person near
#: six. Those runs therefore exercise the suspension path. Six people is the
#: smallest roster that comes out clean, which is what the baseline test needs.
NAMES = ("Anna", "Bartek", "Cezary", "Dora", "Ewa", "Filip")
SPACIOUS_ROSTER = 6


def _roster(count: int = 5) -> list[SolverMember]:
    return [_member(name) for name in NAMES[:count]]


def _slots(result: SolverResult) -> Slots:
    return {(item.service_date, item.role): item.assignee_name for item in result.assignments}


def _waived_rules(result: SolverResult, mode: RotationMode) -> set[str]:
    """Which rules this particular run was never asked to satisfy.

    Weekly rotation is no longer among them: the evaluator takes the mode and
    suspends exactly what the model builder does.
    """
    if any(warning.startswith(SUSPENDED_SPACING) for warning in result.warnings):
        return SPACING_RULES
    return set()


def _violations(
    result: SolverResult, anchor: LateShiftAnchor, mode: RotationMode = RotationMode.hybrid
) -> list[RuleViolation]:
    slots = _slots(result)
    days = sorted({day for day, _role in slots})
    exempt = exempt_days(days, HOLIDAYS)
    found: list[RuleViolation] = []
    for name in sorted({item.assignee_name for item in result.assignments}):
        oncall_days = {
            day for (day, role), holder in slots.items() if role in ONCALL_ROLES and holder == name
        }
        found += oncall_rest_violations(name, oncall_days, exempt, mode=mode)
        found += anchor_violations(name, slots, anchor, HOLIDAYS)
    found += day_off_block_violations(slots, HOLIDAYS)
    found += late_shift_on_day_off(slots, HOLIDAYS)
    return found


def _generate(
    mode: RotationMode,
    *,
    members: list[SolverMember] | None = None,
    anchor: LateShiftAnchor = LateShiftAnchor.secondary,
    continuity_weight: float = 1.0,
) -> SolverResult:
    return generate_schedule(
        starts_on=STARTS,
        ends_on=ENDS,
        mode=mode,
        members=members if members is not None else _roster(),
        historical_points={},
        holidays=HOLIDAYS,
        late_shift_anchor=anchor,
        continuity_weight=continuity_weight,
        solver_workers=1,
        solve_seconds=BUDGET,
    )


CASES = [
    (RotationMode.hybrid, LateShiftAnchor.secondary),
    (RotationMode.hybrid, LateShiftAnchor.independent),
    (RotationMode.daily, LateShiftAnchor.secondary),
    (RotationMode.weekly, LateShiftAnchor.secondary),
]


@pytest.mark.parametrize(("mode", "anchor"), CASES, ids=lambda value: str(value))
def test_the_evaluator_finds_only_rules_the_solver_never_compiled(
    mode: RotationMode, anchor: LateShiftAnchor
) -> None:
    result = _generate(mode, anchor=anchor)
    assert result.assignments, result.conflicts

    waived = _waived_rules(result, mode)
    unexpected = [
        violation
        for violation in _violations(result, anchor, mode)
        if violation.rule not in waived and violation.rule != "late_shift_anchor"
    ]

    assert unexpected == [], [
        (violation.rule, violation.member_name, violation.days) for violation in unexpected
    ]


def test_a_clean_run_really_is_clean_so_the_waivers_are_not_hiding_everything() -> None:
    """Without at least one run the evaluator passes outright, the waiver list
    could be swallowing every violation and the check would prove nothing."""
    result = _generate(
        RotationMode.hybrid,
        members=_roster(count=SPACIOUS_ROSTER),
        anchor=LateShiftAnchor.independent,
    )
    assert result.assignments

    assert SUSPENDED_SPACING not in " ".join(result.warnings)
    assert _violations(result, LateShiftAnchor.independent) == []


def test_the_rest_boundary_rule_is_pinned_where_it_actually_binds() -> None:
    """`rest_after_run` needs a case where the objective is not doing its job.

    The other cases here pass whether or not the model compiles this rule: the
    continuity family already dislikes duty-duty-rest-duty and smooths it away,
    so deleting the constraint changes nothing and the check would not notice.
    At `continuity_weight=0` nothing else discourages the pattern, and deleting
    the constraint does produce it - verified by mutation - so this case is
    what holds the rule rather than merely passing over it.

    `three_in_seven` permits the pattern (three duties over four days is three
    in seven), which is why it cannot stand in for this rule.
    """
    result = _generate(
        RotationMode.hybrid,
        members=_roster(count=SPACIOUS_ROSTER),
        anchor=LateShiftAnchor.independent,
        continuity_weight=0.0,
    )
    assert result.assignments
    assert SUSPENDED_SPACING not in " ".join(result.warnings)

    broken = [
        violation
        for violation in _violations(result, LateShiftAnchor.independent)
        if violation.rule == "rest_after_run"
    ]
    assert broken == [], [(item.member_name, item.days) for item in broken]


def test_the_solver_and_the_evaluator_name_the_same_anchor_mismatches() -> None:
    """Both state the 11-19 pairing rule, so both must see the same breaks.

    One member cannot take 11-19 at all, which the solver permits at a soft
    cost and reports in `anchor_exceptions`; the evaluator derives the same
    days from the finished roster alone.
    """
    members = [*_roster(count=3), _member("Bez zmiany", late_shift=False)]
    result = _generate(RotationMode.hybrid, members=members)
    assert result.assignments

    evaluator_days = {
        day
        for violation in _violations(result, LateShiftAnchor.secondary)
        if violation.rule == "late_shift_anchor"
        for day in violation.days
    }
    solver_days = {
        date.fromisoformat(message.split(":")[0]) for message in result.anchor_exceptions
    }

    assert evaluator_days == solver_days


def test_only_a_suspended_run_waives_anything_and_it_keeps_the_consecutive_limit() -> None:
    """Pins the waiver itself, so a future run cannot quietly widen it.

    A suspended-spacing run drops the rolling windows but keeps
    `max_consecutive`, which is gated separately in the model builder. Weekly
    rotation waives nothing here any more - the evaluator knows the mode, so
    there is nothing left to excuse.
    """
    assert _waived_rules(SolverResult((), (), "OPTIMAL"), RotationMode.weekly) == set()

    suspended = SolverResult((), (), "FEASIBLE", warnings=(f"{SUSPENDED_SPACING} zawieszone",))
    assert _waived_rules(suspended, RotationMode.hybrid) == SPACING_RULES
    assert "max_consecutive" not in _waived_rules(suspended, RotationMode.hybrid)

    assert _waived_rules(SolverResult((), (), "OPTIMAL"), RotationMode.hybrid) == set()
