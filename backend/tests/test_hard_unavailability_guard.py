"""Nobody holds a duty on a day they declared unavailable (guard, not preference).

The model drops a hard-unavailable member from the candidate set, so this check
after solving only fires if the model itself regressed. That makes it the one
piece of `generate_schedule` no end-to-end test can reach: to see it fire, the
model would have to be wrong, and when the model is right the branch is dead.

It became reachable when phase 4q moved it out of `generate_schedule` into a
function over assignments and members, which is what these tests call. The
guard is therefore proven by construction here rather than by hoping a
generation happens to break.
"""

from datetime import date

from oncall.domain.scheduling.solver import PreferenceRange
from oncall.models import AssignmentRole, AvailabilityKind
from oncall.scheduler import (
    DateRange,
    GeneratedAssignment,
    SolverMember,
    _hard_unavailability_conflict,
)

DAY = date(2026, 11, 4)


def _member(name: str, preferences: tuple[PreferenceRange, ...] = ()) -> SolverMember:
    active = DateRange(date(2025, 1, 1), None)
    return SolverMember(
        name=name,
        active=active,
        eligibility={role: (active,) for role in AssignmentRole},
        preferences=preferences,
    )


def _unavailable_on(name: str, day: date) -> SolverMember:
    return _member(name, (PreferenceRange(day, day, AvailabilityKind.unavailable),))


def test_an_ordinary_schedule_reports_nothing() -> None:
    members = [_member("Anna"), _member("Bartek")]
    assignments = [
        GeneratedAssignment(DAY, AssignmentRole.primary, "Anna"),
        GeneratedAssignment(DAY, AssignmentRole.secondary, "Bartek"),
    ]

    assert _hard_unavailability_conflict(assignments, members) is None


def test_a_duty_on_a_declared_unavailable_day_is_reported() -> None:
    members = [_unavailable_on("Anna", DAY), _member("Bartek")]
    assignments = [GeneratedAssignment(DAY, AssignmentRole.primary, "Anna")]

    message = _hard_unavailability_conflict(assignments, members)

    assert message is not None
    assert "Anna" in message
    assert DAY.isoformat() in message
    assert AssignmentRole.primary.value in message


def test_unavailability_on_another_day_does_not_fire() -> None:
    """The check is per day, not per person."""
    members = [_unavailable_on("Anna", date(2026, 11, 5))]
    assignments = [GeneratedAssignment(DAY, AssignmentRole.primary, "Anna")]

    assert _hard_unavailability_conflict(assignments, members) is None


def test_a_softer_preference_is_not_a_violation() -> None:
    """`prefer_not` costs the objective something; it forbids nothing."""
    members = [_member("Anna", (PreferenceRange(DAY, DAY, AvailabilityKind.prefer_not),))]
    assignments = [GeneratedAssignment(DAY, AssignmentRole.primary, "Anna")]

    assert _hard_unavailability_conflict(assignments, members) is None


def test_an_unknown_assignee_is_skipped_rather_than_crashing() -> None:
    """A name outside the roster cannot be judged, and must not raise here:
    this guard runs on a result that is otherwise about to be returned."""
    assignments = [GeneratedAssignment(DAY, AssignmentRole.primary, "Ktoś spoza składu")]

    assert _hard_unavailability_conflict(assignments, [_member("Anna")]) is None


def test_the_first_violation_is_the_one_reported() -> None:
    """One message, naming a concrete day and person, beats a list nobody reads."""
    members = [_unavailable_on("Anna", DAY), _unavailable_on("Bartek", DAY)]
    assignments = [
        GeneratedAssignment(DAY, AssignmentRole.primary, "Anna"),
        GeneratedAssignment(DAY, AssignmentRole.secondary, "Bartek"),
    ]

    message = _hard_unavailability_conflict(assignments, members)

    assert message is not None
    assert "Anna" in message
    assert "Bartek" not in message
