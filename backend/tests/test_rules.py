"""Unit tests for `oncall.rules`, the shared home of the hard roster rules.

Pure functions, no database - the same style as test_fairness.py. Dates:
September 2026, whose 7th is a Monday, so the 12th-13th are the only weekend
inside the first fortnight and no Polish holiday interferes.
"""

from datetime import date, timedelta

from oncall.domain.vocabulary import AssignmentRole, LateShiftAnchor, RotationMode
from oncall.rules import (
    anchor_violations,
    day_off_block_violations,
    exempt_days,
    late_shift_on_day_off,
    oncall_late_shift_overlap,
    oncall_rest_violations,
    substitution_violations,
)

DAY = date(2026, 9, 7)  # Monday


def days_from(start: date, count: int) -> set[date]:
    return {start + timedelta(days=offset) for offset in range(count)}


def test_max_consecutive_flags_a_run_of_four() -> None:
    violations = oncall_rest_violations("Anna", days_from(DAY, 4))
    # Four consecutive days are both too long a run and too many in the window.
    rules = [item.rule for item in violations]
    assert "max_consecutive" in rules
    window = next(item for item in violations if item.rule == "max_consecutive")
    assert window.days == tuple(sorted(days_from(DAY, 4)))


def test_max_consecutive_accepts_a_run_of_three() -> None:
    assert oncall_rest_violations("Anna", days_from(DAY, 3)) == []


def test_three_in_seven_flags_four_duties_in_one_window() -> None:
    served = {DAY, DAY + timedelta(days=1), DAY + timedelta(days=2), DAY + timedelta(days=6)}
    violations = oncall_rest_violations("Anna", served)
    assert [item.rule for item in violations] == ["three_in_seven"]
    assert violations[0].days == tuple(sorted(served))


def test_three_in_seven_accepts_three_duties_in_one_window() -> None:
    served = {DAY, DAY + timedelta(days=2), DAY + timedelta(days=5)}
    assert oncall_rest_violations("Anna", served) == []


def test_rest_after_run_flags_a_single_rest_day() -> None:
    served = {DAY, DAY + timedelta(days=1), DAY + timedelta(days=3)}
    violations = oncall_rest_violations("Anna", served)
    assert [item.rule for item in violations] == ["rest_after_run"]


def test_rest_after_run_accepts_two_rest_days() -> None:
    served = {DAY, DAY + timedelta(days=1), DAY + timedelta(days=4)}
    assert oncall_rest_violations("Anna", served) == []


def test_long_day_off_block_is_exempt_from_rest_rules() -> None:
    # A four-day Christmas block (Thu 25th and Fri 26th are holidays, then the
    # weekend) is one indivisible decision: the holder serves four consecutive
    # days without breaking the consecutive-day rule.
    block = [date(2025, 12, 25), date(2025, 12, 26), date(2025, 12, 27), date(2025, 12, 28)]
    holidays = {date(2025, 12, 25), date(2025, 12, 26)}
    exempt = exempt_days(block, holidays)
    assert exempt == set(block)
    assert oncall_rest_violations("Anna", set(block), exempt) == []


def test_anchor_flags_a_split_shift() -> None:
    slots = {
        (DAY, AssignmentRole.secondary): "Anna",
        (DAY, AssignmentRole.late_shift): "Marek",
    }
    violations = anchor_violations("Anna", slots, LateShiftAnchor.secondary, holidays=set())
    assert [item.rule for item in violations] == ["late_shift_anchor"]
    assert violations[0].days == (DAY,)


def test_anchor_accepts_the_same_person_and_the_independent_mode() -> None:
    slots = {
        (DAY, AssignmentRole.secondary): "Anna",
        (DAY, AssignmentRole.late_shift): "Anna",
    }
    assert anchor_violations("Anna", slots, LateShiftAnchor.secondary, holidays=set()) == []
    split = {
        (DAY, AssignmentRole.secondary): "Anna",
        (DAY, AssignmentRole.late_shift): "Marek",
    }
    assert anchor_violations("Anna", split, LateShiftAnchor.independent, holidays=set()) == []


def test_oncall_late_shift_overlap_accepts_the_anchored_pairing() -> None:
    """QA7 par. 8, D3 review: with 11-19 anchored to secondary, one person
    holding secondary and 11-19 together is the policy working as designed
    (`anchor_violations` is what flags that pairing coming apart), not a
    fatigue violation - this used to fire on every ordinary day the anchor
    was in effect."""
    slots = {
        (DAY, AssignmentRole.secondary): "Anna",
        (DAY, AssignmentRole.late_shift): "Anna",
    }
    assert oncall_late_shift_overlap(slots, LateShiftAnchor.secondary) == []


def test_oncall_late_shift_overlap_flags_the_non_anchor_role() -> None:
    """The genuine fatigue case: the *other* on-call role coinciding with
    11-19 is not something the anchor policy arranges on purpose."""
    slots = {
        (DAY, AssignmentRole.primary): "Anna",
        (DAY, AssignmentRole.secondary): "Marek",
        (DAY, AssignmentRole.late_shift): "Anna",
    }
    violations = oncall_late_shift_overlap(slots, LateShiftAnchor.secondary)
    assert [(item.rule, item.member_name) for item in violations] == [
        ("oncall_late_shift_overlap", "Anna")
    ]


def test_oncall_late_shift_overlap_flags_both_roles_when_independent() -> None:
    """Without an anchor policy, neither pairing is designed-for."""
    secondary_pair = {
        (DAY, AssignmentRole.secondary): "Anna",
        (DAY, AssignmentRole.late_shift): "Anna",
    }
    assert oncall_late_shift_overlap(secondary_pair, LateShiftAnchor.independent) != []
    primary_pair = {
        (DAY, AssignmentRole.primary): "Anna",
        (DAY, AssignmentRole.late_shift): "Anna",
    }
    assert oncall_late_shift_overlap(primary_pair, LateShiftAnchor.independent) != []


def test_day_off_block_flags_a_split_weekend() -> None:
    weekend = [DAY + timedelta(days=5), DAY + timedelta(days=6)]  # Sat, Sun
    slots = {
        (day, AssignmentRole.primary): name
        for day, name in zip(weekend, ("Anna", "Marek"), strict=True)
    }
    violations = day_off_block_violations(slots, holidays=set())
    assert {item.rule for item in violations} == {"day_off_block"}
    assert {item.member_name for item in violations} == {"Anna", "Marek"}


def test_day_off_block_accepts_one_holder() -> None:
    weekend = [DAY + timedelta(days=5), DAY + timedelta(days=6)]
    slots = {(day, AssignmentRole.primary): "Anna" for day in weekend}
    assert day_off_block_violations(slots, holidays=set()) == []


def test_late_shift_on_day_off_flags_a_weekend_shift() -> None:
    saturday = DAY + timedelta(days=5)
    slots = {(saturday, AssignmentRole.late_shift): "Anna"}
    violations = late_shift_on_day_off(slots, holidays=set())
    assert [item.rule for item in violations] == ["late_shift_on_day_off"]
    assert violations[0].days == (saturday,)


def test_late_shift_on_day_off_accepts_a_working_day() -> None:
    slots = {(DAY, AssignmentRole.late_shift): "Anna"}
    assert late_shift_on_day_off(slots, holidays=set()) == []


def test_substitution_reports_only_newly_created_violations() -> None:
    # Magdalena already serves 22-24; the swap would add the 28th into the
    # same seven-day window - the regression case from QA-REPORT-5, HGH5-03.
    base = date(2026, 9, 22)
    slots = {
        (day, AssignmentRole.secondary): "Magdalena Woźniak"
        for day in (base, base + timedelta(days=1), base + timedelta(days=2))
    }
    slots[(base + timedelta(days=6), AssignmentRole.secondary)] = "Julia Kowal"
    violations = substitution_violations(
        slots,
        [(base + timedelta(days=6), AssignmentRole.secondary)],
        "Julia Kowal",
        "Magdalena Woźniak",
        LateShiftAnchor.independent,
        holidays=set(),
    )
    assert [item.rule for item in violations] == ["three_in_seven"]
    assert violations[0].member_name == "Magdalena Woźniak"


def test_substitution_ignores_a_preexisting_violation() -> None:
    # The roster already breaks three_in_seven for Anna; moving an unrelated
    # slot of hers must not re-report what was already there.
    base = date(2026, 9, 22)
    slots = {
        (day, AssignmentRole.secondary): "Anna"
        for day in (base, base + timedelta(days=1), base + timedelta(days=2))
    }
    slots[(base + timedelta(days=6), AssignmentRole.secondary)] = "Anna"
    slots[(base + timedelta(days=20), AssignmentRole.primary)] = "Anna"
    violations = substitution_violations(
        slots,
        [(base + timedelta(days=20), AssignmentRole.primary)],
        "Anna",
        "Marek",
        LateShiftAnchor.independent,
        holidays=set(),
    )
    assert violations == []


def test_weekly_rotation_states_no_rest_rule() -> None:
    """A week-long run is what weekly rotation means, not a rule break.

    The solver compiles none of the three rolling rest constraints in this
    mode, so an evaluator that reports them contradicts the roster it was
    handed: a clean weekly schedule showed the coordinator five hard-rule
    warnings on every generation.
    """
    whole_week = days_from(DAY, 7)

    assert oncall_rest_violations("Anna", whole_week, mode=RotationMode.weekly) == []
    # Under any other mode the same week breaks two of the three: an unbroken
    # run never reaches `rest_after_run`, which needs a single rest day in the
    # middle of it.
    assert {item.rule for item in oncall_rest_violations("Anna", whole_week)} == {
        "max_consecutive",
        "three_in_seven",
    }


def test_every_other_rotation_keeps_the_rest_rules() -> None:
    """Only weekly is exempt, and a roster that never recorded its mode - an
    import, or a schedule older than the column - is judged by the full set."""
    whole_week = days_from(DAY, 7)

    for mode in (RotationMode.daily, RotationMode.hybrid, None):
        rules = {item.rule for item in oncall_rest_violations("Anna", whole_week, mode=mode)}
        assert "max_consecutive" in rules, mode


def test_a_swap_inside_a_weekly_roster_is_not_blocked_by_the_rest_rules() -> None:
    """The same suspension reaches the swap path, or the mode would produce
    rosters its own swap screen refuses to edit."""
    slots = {
        (DAY + timedelta(days=offset), role): "Anna"
        for offset in range(7)
        for role in (AssignmentRole.primary,)
    }
    slots[(DAY + timedelta(days=7), AssignmentRole.primary)] = "Bartek"
    move = [(DAY + timedelta(days=7), AssignmentRole.primary)]

    blocked = substitution_violations(
        slots, move, "Bartek", "Anna", LateShiftAnchor.secondary, set()
    )
    allowed = substitution_violations(
        slots, move, "Bartek", "Anna", LateShiftAnchor.secondary, set(), RotationMode.weekly
    )

    assert {item.rule for item in blocked} == {"max_consecutive", "three_in_seven"}
    assert allowed == []
