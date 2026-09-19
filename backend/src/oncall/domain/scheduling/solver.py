"""What the generator is asked and what it answers, independent of the solver.

The CP-SAT model in `oncall.scheduler` reads and returns these; the use case
builds the question from the team and the history it loads through its ports,
and turns the answer into a draft. Nothing here knows how the answer is found.
"""

from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date

from oncall.domain.vocabulary import AssignmentRole, AvailabilityKind, LateShiftAnchor, RotationMode


@dataclass(frozen=True)
class DateRange:
    starts_on: date
    ends_on: date | None

    def contains(self, day: date) -> bool:
        return self.starts_on <= day and (self.ends_on is None or day <= self.ends_on)


@dataclass(frozen=True)
class PreferenceRange(DateRange):
    kind: AvailabilityKind = AvailabilityKind.unavailable


@dataclass(frozen=True)
class SolverMember:
    name: str
    active: DateRange
    eligibility: dict[AssignmentRole, tuple[DateRange, ...]]
    preferences: tuple[PreferenceRange, ...] = field(default_factory=tuple)

    def eligible(self, role: AssignmentRole, day: date) -> bool:
        return self.active.contains(day) and any(
            period.contains(day) for period in self.eligibility.get(role, ())
        )

    def preference(self, day: date) -> AvailabilityKind | None:
        matches = [item.kind for item in self.preferences if item.contains(day)]
        for kind in (
            AvailabilityKind.unavailable,
            AvailabilityKind.prefer_not,
            AvailabilityKind.prefer,
        ):
            if kind in matches:
                return kind
        return None


@dataclass(frozen=True)
class GeneratedAssignment:
    service_date: date
    role: AssignmentRole
    assignee_name: str


@dataclass(frozen=True)
class SolverResult:
    assignments: tuple[GeneratedAssignment, ...]
    conflicts: tuple[str, ...]
    status: str
    anchor_exceptions: tuple[str, ...] = ()
    warnings: tuple[str, ...] = ()
    failure_reason: str | None = None
    #: Lowest achievable lens spread when the acceptance criterion proved
    #: unattainable (decision D2); None when the criterion holds by
    #: construction or the run failed before the question made sense.
    acceptance_floor: int | None = None
    fairness_proven: bool = False
    continuity_gap: float | None = None


@dataclass(frozen=True)
class SolveProblem:
    """One horizon to fill, with everything the generator scores it against."""

    starts_on: date
    ends_on: date
    mode: RotationMode
    members: list[SolverMember]
    historical_points: dict[tuple[str, AssignmentRole], float]
    prior_oncall: dict[str, set[date]]
    holidays: set[date]
    historical_lenses: dict[tuple[str, str], float]
    history_window: tuple[date, date]
    fairness_weight: float
    continuity_weight: float
    preference_weight: float
    late_shift_anchor: LateShiftAnchor
    solve_seconds: float


#: Receives the solver's progress milestones as they happen.
ProgressCallback = Callable[[str], None]

#: ``solve_seconds`` is the budget of one ``solver.solve`` call. A single
#: generation runs several in sequence: the criterion pass, at most two spacing
#: / cap fallbacks, then the bisection that reports the achievable floor. This
#: many per-pass budgets is the hard wall-clock ceiling for the whole run -
#: ``generate_schedule`` tracks a deadline and hands every pass only the time
#: left, so the number the screen shows is the number the coordinator waits
#: for. Four covers the worst sequential path; the floor bisection lives on
#: whatever is left and is skipped when nothing is (its result is advisory).
GENERATION_BUDGET_PASSES = 4


def total_time_budget(solve_seconds: float) -> float:
    """The hard wall-clock ceiling for one generation, from the per-pass budget."""
    return solve_seconds * GENERATION_BUDGET_PASSES
