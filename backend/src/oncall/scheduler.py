import time
from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, timedelta
from functools import partial
from math import ceil

from ortools.sat.python import cp_model

from oncall.config import available_cpu_count
from oncall.domain.scheduling.solver import GENERATION_BUDGET_PASSES as GENERATION_BUDGET_PASSES
from oncall.domain.scheduling.solver import DateRange as DateRange
from oncall.domain.scheduling.solver import (
    GeneratedAssignment,
    SolverMember,
    SolverResult,
    total_time_budget,
)
from oncall.domain.scheduling.solver import PreferenceRange as PreferenceRange
from oncall.domain.vocabulary import (
    ROLE_LABELS as ROLE_LABELS,
)
from oncall.domain.vocabulary import (
    AssignmentRole,
    AvailabilityKind,
    LateShiftAnchor,
    RotationMode,
)
from oncall.fairness import ACCEPTANCE_POINTS, slot_exposure
from oncall.rules import MAX_CONSECUTIVE_ONCALL_DAYS, exempt_days, oncall_rest_violations
from oncall.workdays import is_working_day


@dataclass(frozen=True)
class _Lens:
    """One fairness lens used by the single, distribution-aware objective."""

    label: str
    deviations: tuple[_Term, ...]
    #: Where a perfectly even split would put every deviation.
    mean: int
    #: Widest a deviation can be from that mean, so the squares stay bounded.
    span: int
    lower_bound: int
    upper_bound: int
    #: Whether the lens fights for the acceptance criterion with a range term.
    #: The anchored 11-19 lens is not graded (decision D1).
    graded: bool = True


@dataclass(frozen=True)
class _ModelBuildContext:
    """Inputs shared by every CP-SAT model built for one generation."""

    starts_on: date
    ends_on: date
    mode: RotationMode
    members: list[SolverMember]
    historical_points: dict[tuple[str, AssignmentRole], float]
    holidays: set[date]
    historical_lenses: dict[tuple[str, str], float] | None
    history_window: tuple[date, date] | None
    fairness_weight: float
    continuity_weight: float
    preference_weight: float
    late_shift_anchor: LateShiftAnchor
    prior_oncall: dict[str, set[date]] | None = None


#: One objective or deviation term. CP-SAT takes a plain integer wherever it
#: takes an expression, and a term built by summing an empty family is one, so
#: the narrower `LinearExpr` would be a lie about what these lists hold.
_Term = cp_model.LinearExpr | int

_AssignmentVariables = dict[tuple[int, AssignmentRole, int], cp_model.IntVar]
_OnCallVariables = dict[tuple[int, int], cp_model.IntVar]
_BuiltModel = tuple[cp_model.CpModel, _AssignmentVariables, list[str], list[_Lens]]


@dataclass(frozen=True)
class _CoverageModel:
    model: cp_model.CpModel
    days: list[date]
    variables: _AssignmentVariables
    conflicts: list[str]
    day_off_blocks: list[list[int]]


@dataclass(frozen=True)
class _LateShiftCoupling:
    anchor_role: AssignmentRole
    preference_terms: tuple[_Term, ...]


@dataclass(frozen=True)
class _LensDefinition:
    """One fairness lens as data: which duties it counts and what they weigh."""

    label: str
    roles: tuple[AssignmentRole, ...]
    #: Whether a day counts toward this lens at all.
    counts: Callable[[date], bool]
    #: What one `(day, role)` slot of this lens is worth.
    weight: Callable[[date], int]
    #: Points each member already carries in this lens, from the history window.
    historical: dict[str, float]
    graded: bool = True


def _days(starts_on: date, ends_on: date) -> list[date]:
    return [starts_on + timedelta(days=offset) for offset in range((ends_on - starts_on).days + 1)]


def _solution_gap(solver: cp_model.CpSolver, status: cp_model.CpSolverStatus) -> float | None:
    if status == cp_model.OPTIMAL:
        return 0.0
    try:
        value = solver.objective_value
        bound = solver.best_objective_bound
    except RuntimeError:
        return None
    return max(0.0, abs(value - bound) / max(1.0, abs(value)))


#: Wall clock available to the single solver pass.
SOLVE_SECONDS = 15.0

#: Progress milestones handed to `progress_callback`. Named here rather than
#: spelled out in the worker, so the two cannot drift apart.
MODEL_BUILT = "model_built"
SOLVE_DONE = "solve_done"
#: Emitted as ``"solve_pass <seconds>"`` at the start of every solver pass.
SOLVE_PASS = "solve_pass"


def date_ranges(days: list[date]) -> str:
    """Consecutive days as ranges: 2026-09-01 - 2026-09-07, 2026-09-10."""
    if not days:
        return ""
    ordered = sorted(days)
    spans: list[tuple[date, date]] = [(ordered[0], ordered[0])]
    for day in ordered[1:]:
        first, last = spans[-1]
        if day - last == timedelta(days=1):
            spans[-1] = (first, day)
        else:
            spans.append((day, day))
    return ", ".join(
        first.isoformat() if first == last else f"{first.isoformat()} - {last.isoformat()}"
        for first, last in spans
    )


# The acceptance criterion constant lives in `oncall.fairness`, next to the
# report that defines the product metric, and is imported here as
# ACCEPTANCE_POINTS. In the solver it is compiled as a hard constraint for
# the real run whenever the roster can meet it, so the criterion holds by
# construction rather than by luck of the search (decision D2). The solver
# counts in its own units, roughly a point off the report metric at worst;
# the binding check stays the draft impact preview.

#: Bisection bounds and per-probe budget for the deviation mechanism: when the
#: criterion proves unattainable, the coordinator is told the lowest achievable
#: spread instead of being left with a silent failure. Proving a cap
#: infeasible takes under a second on the measured instance; finding a
#: feasible solution always burns the whole probe budget, so it stays short.
FLOOR_PROBE_MAX_POINTS = 10
FLOOR_PROBE_SECONDS = 25.0

#: Below this many seconds left, an optional pass (the floor bisection) is not
#: worth starting.
MIN_PASS_SECONDS = 1.0

#: Data loading, the worker hand-off and progress writes sit outside the solver
#: but inside what the coordinator waits for. The passes finish this many
#: seconds early so the whole run still lands within the ceiling the screen
#: shows (measured overhead is ~1.5 s; this doubles it for headroom).
GENERATION_ORCHESTRATION_RESERVE = 3.0


#: Shared per-decision base for the objective families. Every coefficient is
#: ``round(MARGINAL_BASE * weight / step)`` where ``step`` is the deviation one
#: decision moves in that family's own units:
#
#:   - preference: one assignment is a step of 1;
#:   - continuity: one roster boundary (transition) is a step of 1;
#:   - fairness: one duty point is a step of SCALE (10), because the range term
#:     moves in raw deviation units and a weekday duty adds ``weight * SCALE``.
#
#: Because the steps are per decision rather than per family maximum, a duty is
#: traded against a boundary or a preference slot at coefficients that roughly
#: mirror the slider weights, no matter the horizon. The previous scheme
#: normalized each family by its maximum, but the families have very different
#: granularities: for a 28-day roster it produced coefficients of 246 (fairness)
#: vs 26667 (preference) vs 6944 (continuity), so one prefer-flagged assignment
#: outbid a whole point of fairness and the preferred member could hoard an
#: entire lens regardless of the fairness weight. A family maximum can be huge
#: while every single decision is cheap; the slider weights one decision against
#: another, not one worst case against another.
MARGINAL_BASE = 1000

#: One fairness coefficient step: deviation units that a single duty point
#: moves a lens term. Deviations are carried in tenths of a point so the float
#: baseline survives the move into an integer model.
SCALE = 10

#: Fairness coefficient step, in deviation units. Smaller than ``SCALE``: one
#: duty moves the range/spread terms by ``weight * SCALE``, but a whole weekend
#: block (two days at double points) moves them by ``4 * SCALE``, so a step of
#: ``SCALE / 2`` keeps the per-duty fairness bid higher than any single
#: preference assignment (even a double-role weekend) while still letting a
#: really low fairness slider hand the roster to preference/continuity.
FAIRNESS_STEP = SCALE // 2

#: Price of the anchored 11-19 distribution terms, as a fraction of the graded
#: fairness price. The measured value is zero: any fraction that visibly
#: steadied the 11-19 count pushed `secondary` past the 3-point acceptance
#: criterion on the report metric, while buying that lens only about one point
#: of spread; the runs are in docs/qa-suite-5/tie-break.jsonl. Zero compiles
#: the tie-breaker out entirely; raise it only after a re-measurement.
TIE_BREAK_FRACTION = 0.0

#: The roles that share one duty roster; the 11-19 shift is balanced on its own.
ONCALL_ROLES = (AssignmentRole.primary, AssignmentRole.secondary)
# MAX_CONSECUTIVE_ONCALL_DAYS lives in `oncall.rules` and is imported here, so
# the solver's limit and the post-publication checks share one constant.


def _role_day_weight(role: AssignmentRole, day: date, holidays: set[date]) -> int:
    if role == AssignmentRole.late_shift:
        return 1
    return 1 if is_working_day(day, holidays) else 2


def _role_counts_day(role: AssignmentRole, day: date, holidays: set[date]) -> bool:
    """Whether a day carries duty for this role at all.

    11-19 is a weekday shift, so a weekend or holiday holds none; the two
    on-call roles are held every day of the year.
    """
    return role != AssignmentRole.late_shift or is_working_day(day, holidays)


def _is_hard_unavailable(member: SolverMember, day: date) -> bool:
    """Whether the member declared themselves unavailable, not merely unwilling."""
    return member.preference(day) == AvailabilityKind.unavailable


def marginal_cost(weight: float, step: float) -> int:
    """Objective coefficient for one decision of a family.

    ``step`` is how far the family's terms move for one duty-sized decision, in
    the family's own units (see :data:`MARGINAL_BASE`). At a step of 1 the
    coefficient is ``MARGINAL_BASE * weight``, so at any weight each family
    buys influence into the objective at the same per-decision price; a
    fairness coefficient uses a step of ``SCALE`` because one point of a lens
    moves its range and spread terms by ``weight * SCALE``.
    """
    if weight <= 0 or step <= 0:
        return 0
    return max(1, round(MARGINAL_BASE * weight / step))


def _build_coverage(context: _ModelBuildContext) -> _CoverageModel:
    """Create one candidate variable per coverable slot and its exact cover rule."""
    days = _days(context.starts_on, context.ends_on)
    model = cp_model.CpModel()
    variables: _AssignmentVariables = {}
    conflicts: list[str] = []

    # A weekend or holiday block is one decision: the generated roster never
    # splits a person's rest block. Coordinators may still do so after solving.
    day_off_blocks: list[list[int]] = []
    running_block: list[int] = []
    for day_index, day in enumerate(days):
        if is_working_day(day, context.holidays):
            if len(running_block) >= 2:
                day_off_blocks.append(running_block)
            running_block = []
        else:
            running_block.append(day_index)
    if len(running_block) >= 2:
        day_off_blocks.append(running_block)
    block_of = {day_index: block for block in day_off_blocks for day_index in block}

    uncovered: dict[tuple[AssignmentRole, str], list[date]] = defaultdict(list)
    for day_index, day in enumerate(days):
        block = block_of.get(day_index)
        if block is not None and block[0] != day_index:
            continue
        if block is not None:
            span = f"{days[block[0]].isoformat()} - {days[block[-1]].isoformat()}"
            qualified: dict[AssignmentRole, list[int]] = {role: [] for role in AssignmentRole}
            for role in AssignmentRole:
                for member_index, member in enumerate(context.members):
                    if not all(
                        member.eligible(role, days[block_day])
                        and member.preference(days[block_day]) != AvailabilityKind.unavailable
                        for block_day in block
                    ):
                        continue
                    qualified[role].append(member_index)
            for role in ONCALL_ROLES:
                eligible = []
                for member_index in qualified[role]:
                    variable = model.new_bool_var(f"x_{day_index}_{role.value}_{member_index}")
                    for block_day in block:
                        variables[(block_day, role, member_index)] = variable
                    eligible.append(variable)
                if eligible:
                    model.add_exactly_one(eligible)
                else:
                    conflicts.append(
                        f"{span}: brak osoby, która może objąć cały blok jako {ROLE_LABELS[role]}"
                    )
            primary_people = set(qualified[AssignmentRole.primary])
            secondary_people = set(qualified[AssignmentRole.secondary])
            if primary_people and secondary_people and len(primary_people | secondary_people) < 2:
                only = context.members[primary_people.pop()].name
                conflicts.append(
                    f"{span}: tylko {only} może objąć cały blok, "
                    "a PRIMARY i SECONDARY muszą być różnymi osobami"
                )
            continue
        for role in AssignmentRole:
            if role == AssignmentRole.late_shift and not is_working_day(day, context.holidays):
                continue
            eligible = []
            for member_index, member in enumerate(context.members):
                if not member.eligible(role, day):
                    continue
                if member.preference(day) == AvailabilityKind.unavailable:
                    continue
                variable = model.new_bool_var(f"x_{day_index}_{role.value}_{member_index}")
                variables[(day_index, role, member_index)] = variable
                eligible.append(variable)
            if eligible:
                model.add_exactly_one(eligible)
            else:
                blocked = any(
                    member.eligible(role, day)
                    and member.preference(day) == AvailabilityKind.unavailable
                    for member in context.members
                )
                uncovered[(role, "unavailable" if blocked else "eligibility")].append(day)

    for (role, cause), uncovered_days in sorted(
        uncovered.items(), key=lambda item: (item[0][0].value, item[0][1])
    ):
        reason = (
            "wszyscy eligible zgłosili niedostępność"
            if cause == "unavailable"
            else "nikt nie ma eligibility do tej roli"
        )
        conflicts.append(f"{ROLE_LABELS[role]}: {reason} - {date_ranges(uncovered_days)}")

    for day_index in range(len(days)):
        for member_index in range(len(context.members)):
            primary = variables.get((day_index, AssignmentRole.primary, member_index))
            secondary = variables.get((day_index, AssignmentRole.secondary, member_index))
            if primary is not None and secondary is not None:
                model.add(primary + secondary <= 1)

    return _CoverageModel(model, days, variables, conflicts, day_off_blocks)


def _add_rest_constraints(
    context: _ModelBuildContext, coverage: _CoverageModel, *, spacing: bool
) -> _OnCallVariables:
    """Add consecutive-duty, rolling-spacing and rest-boundary constraints."""
    model = coverage.model
    days = coverage.days
    variables = coverage.variables
    members = context.members
    prior_oncall = context.prior_oncall or {}

    oncall_by_day_member: _OnCallVariables = {}
    for day_index in range(len(days)):
        for member_index in range(len(members)):
            duty_vars = [
                variable
                for role in ONCALL_ROLES
                if (variable := variables.get((day_index, role, member_index))) is not None
            ]
            if not duty_vars:
                continue
            oncall = model.new_bool_var(f"oncall_{day_index}_{member_index}")
            model.add(oncall == sum(duty_vars))
            oncall_by_day_member[(day_index, member_index)] = oncall

    # Long day-off blocks are exempt from rolling limits because they cannot be
    # split. Their holder rests on both adjacent days instead.
    extended_days = _days(context.starts_on - timedelta(days=6), context.ends_on)
    long_block_dates = exempt_days(extended_days, context.holidays)

    def oncall_value(day_index: int, member_index: int) -> _Term:
        if day_index < 0:
            day = context.starts_on + timedelta(days=day_index)
            return int(day in prior_oncall.get(members[member_index].name, set()))
        return oncall_by_day_member.get((day_index, member_index), 0)

    def add_bounded_window(values: list[_Term], limit: int) -> None:
        variables_in_window = [value for value in values if not isinstance(value, int)]
        if not variables_in_window:
            return
        fixed = sum(value for value in values if isinstance(value, int))
        model.add(sum(variables_in_window) <= max(0, limit - fixed))

    if context.mode != RotationMode.weekly and len(days) > MAX_CONSECUTIVE_ONCALL_DAYS:
        window_size = MAX_CONSECUTIVE_ONCALL_DAYS + 1
        for member_index in range(len(members)):
            for start in range(-window_size + 1, len(days) - window_size + 1):
                indexes = range(start, start + window_size)
                values = [
                    oncall_value(day_index, member_index)
                    for day_index in indexes
                    if context.starts_on + timedelta(days=day_index) not in long_block_dates
                ]
                add_bounded_window(values, MAX_CONSECUTIVE_ONCALL_DAYS)

    if spacing:
        for member_index in range(len(members)):
            for start in range(-6, len(days) - 6):
                values = [
                    oncall_value(day_index, member_index)
                    for day_index in range(start, start + 7)
                    if context.starts_on + timedelta(days=day_index) not in long_block_dates
                ]
                add_bounded_window(values, 3)
            for middle in range(-1, len(days) - 2):
                boundary_indexes = (middle - 1, middle, middle + 1, middle + 2)
                if any(
                    context.starts_on + timedelta(days=index) in long_block_dates
                    for index in boundary_indexes
                ):
                    continue
                before, current, rest, after = (
                    oncall_value(index, member_index) for index in boundary_indexes
                )
                if all(isinstance(value, int) for value in (before, current, rest, after)):
                    continue
                model.add(before + current + after - rest <= 2)

    for block in coverage.day_off_blocks:
        if len(block) <= MAX_CONSECUTIVE_ONCALL_DAYS:
            continue
        for member_index in range(len(members)):
            holder_vars = {
                id(variable): variable
                for block_day in block
                for role in ONCALL_ROLES
                if (variable := variables.get((block_day, role, member_index))) is not None
            }
            for boundary in (block[0] - 1, block[-1] + 1):
                if not 0 <= boundary < len(days):
                    continue
                for role in ONCALL_ROLES:
                    adjacent = variables.get((boundary, role, member_index))
                    if adjacent is None:
                        continue
                    for holder_var in holder_vars.values():
                        model.add(holder_var + adjacent <= 1)

    return oncall_by_day_member


def _add_late_shift_coupling(
    context: _ModelBuildContext, coverage: _CoverageModel
) -> _LateShiftCoupling:
    """Tie 11-19 to its anchor role and return any permitted mismatch costs."""
    anchor_role = (
        AssignmentRole.primary
        if context.late_shift_anchor == LateShiftAnchor.primary
        else AssignmentRole.secondary
    )
    preference_terms: list[_Term] = []
    if context.late_shift_anchor == LateShiftAnchor.independent:
        return _LateShiftCoupling(anchor_role, ())

    for day_index, day in enumerate(coverage.days):
        if not is_working_day(day, context.holidays):
            continue
        for member_index, member in enumerate(context.members):
            anchor = coverage.variables.get((day_index, anchor_role, member_index))
            late_shift = coverage.variables.get(
                (day_index, AssignmentRole.late_shift, member_index)
            )

            # When both eligibility periods cover the day, a missing variable
            # means hard unavailability and therefore forces its counterpart off.
            if member.eligible(anchor_role, day) and member.eligible(
                AssignmentRole.late_shift, day
            ):
                if anchor is not None and late_shift is not None:
                    coverage.model.add(anchor == late_shift)
                elif anchor is not None:
                    coverage.model.add(anchor == 0)
                elif late_shift is not None:
                    coverage.model.add(late_shift == 0)
                continue

            # A person eligible only for the anchor role remains usable there;
            # the mismatch is a soft term and is reported after solving.
            if anchor is not None and not member.eligible(AssignmentRole.late_shift, day):
                preference_terms.append(anchor)

    return _LateShiftCoupling(anchor_role, tuple(preference_terms))


def _assignment_preference_terms(
    context: _ModelBuildContext, coverage: _CoverageModel
) -> tuple[_Term, ...]:
    """Penalize ``prefer_not`` assignments and reward ``prefer`` assignments."""
    terms: list[_Term] = []
    for (day_index, _role, member_index), variable in coverage.variables.items():
        preference = context.members[member_index].preference(coverage.days[day_index])
        if preference == AvailabilityKind.prefer_not:
            terms.append(variable)
        elif preference == AvailabilityKind.prefer:
            terms.append(-variable)
    return tuple(terms)


def _add_weekly_spacing_terms(
    context: _ModelBuildContext,
    coverage: _CoverageModel,
    oncall_by_day_member: _OnCallVariables,
) -> tuple[_Term, ...]:
    """Price a member's second and later on-call day inside one calendar week.

    Weekly rotation has nothing to spread out, so it gets no terms at all.
    """
    if context.mode == RotationMode.weekly:
        return ()

    model = coverage.model
    terms: list[_Term] = []
    week_indexes: dict[tuple[int, int], list[int]] = {}
    for day_index, day in enumerate(coverage.days):
        year, week, _weekday = day.isocalendar()
        week_indexes.setdefault((year, week), []).append(day_index)
    for member_index in range(len(context.members)):
        for (year, week), indexes in week_indexes.items():
            duties = [
                variable
                for day_index in indexes
                if (variable := oncall_by_day_member.get((day_index, member_index))) is not None
            ]
            if len(duties) < 2:
                continue
            second_duty = model.new_int_var(
                0, len(duties) - 1, f"second_duty_{member_index}_{year}_{week}"
            )
            model.add(second_duty >= sum(duties) - 1)
            terms.append(second_duty)
    return tuple(terms)


def _add_continuity_terms(
    context: _ModelBuildContext, coverage: _CoverageModel
) -> tuple[_Term, ...]:
    """Price how many separate duty runs a member has inside one calendar week.

    A run is one to three consecutive days covered by a single variable, so the
    cost counts fragments rather than days and a person who serves Monday to
    Wednesday pays less than one who serves Monday, Wednesday and Friday.
    Daily rotation wants no continuity at all; weekly rotation pays ten times
    the hybrid price, which is what makes a whole week hold together.
    """
    if context.mode == RotationMode.daily:
        return ()

    model = coverage.model
    days = coverage.days
    variables = coverage.variables
    members = context.members

    terms: list[_Term] = []
    multiplier = 1 if context.mode == RotationMode.hybrid else 10
    weeks = sorted({day.isocalendar()[:2] for day in days})
    for year, week in weeks:
        week_indices = [
            index for index, day in enumerate(days) if day.isocalendar()[:2] == (year, week)
        ]
        for role in AssignmentRole:
            role_runs: list[cp_model.IntVar] = []
            for member_index in range(len(members)):
                runs: list[tuple[cp_model.IntVar, tuple[int, ...]]] = []
                for start_pos, start_index in enumerate(week_indices):
                    for length in range(1, min(3, len(week_indices) - start_pos) + 1):
                        covered = tuple(week_indices[start_pos : start_pos + length])
                        if any(
                            variables.get((index, role, member_index)) is None for index in covered
                        ):
                            break
                        run = model.new_bool_var(
                            f"run_{year}_{week}_{role}_{member_index}_{start_index}_{length}"
                        )
                        runs.append((run, covered))
                        role_runs.append(run)
                for index in week_indices:
                    assignment = variables.get((index, role, member_index))
                    if assignment is None:
                        continue
                    covering = [run for run, covered in runs if index in covered]
                    model.add(assignment == sum(covering))
            if role_runs:
                terms.append((sum(role_runs) - 1) * 2 * multiplier)
    return tuple(terms)


def _fairness_lens(
    context: _ModelBuildContext,
    coverage: _CoverageModel,
    definition: _LensDefinition,
    history_days: list[date],
) -> _Lens | None:
    """One fairness lens: how far each person is from their fair share of it.

    A lens is a set of duties that has to come out even on its own - the two
    on-call roles, the 11-19 shift, and, because points alone would let one
    person take every Saturday and stay level, weekend and holiday duty.

    Returns ``None`` when fewer than two members can hold any of its duties,
    because a lens nobody competes for has nothing to level.
    """
    members = context.members
    days = coverage.days
    variables = coverage.variables
    roles = definition.roles
    counts = definition.counts
    weight = definition.weight
    historical = definition.historical

    def member_exposure(member: SolverMember, span_start: date, span_end: date) -> float:
        """The member's exposure to this lens over one window - the same
        per-`(day, role)`-slot formula the fairness report uses, dropping
        hard-unavailable days (decision D3, variant B)."""
        return slot_exposure(
            roles=roles,
            window_start=span_start,
            window_end=span_end,
            include=counts,
            weight=weight,
            is_eligible=member.eligible,
            is_unavailable=partial(_is_hard_unavailable, member),
        )

    historical_total = sum(historical.get(member.name, 0.0) for member in members)
    historical_exposure = {
        member.name: member_exposure(member, history_days[0], history_days[-1])
        if history_days
        else 0.0
        for member in members
    }
    historical_exposure_total = sum(historical_exposure.values())
    horizon_total = sum(weight(day) for day in days if counts(day) for _role in roles)
    horizon_exposure = {
        member.name: member_exposure(member, days[0], days[-1]) for member in members
    }
    horizon_exposure_total = sum(horizon_exposure.values())

    deviations: list[_Term] = []
    baselines: list[int] = []
    upper_bounds: list[int] = []
    for member_index, member in enumerate(members):
        weighted = [
            variables[(day_index, role, member_index)] * weight(day)
            for day_index, day in enumerate(days)
            if counts(day)
            for role in roles
            if (day_index, role, member_index) in variables
        ]
        if not weighted:
            continue
        historical_expected = (
            historical_total * historical_exposure[member.name] / historical_exposure_total
            if historical_exposure_total
            else 0.0
        )
        horizon_expected = (
            horizon_total * horizon_exposure[member.name] / horizon_exposure_total
            if horizon_exposure_total
            else 0.0
        )
        baseline = round(
            (historical.get(member.name, 0.0) - historical_expected - horizon_expected) * SCALE
        )
        deviations.append(baseline + sum(weighted) * SCALE)
        baselines.append(baseline)
        upper_bounds.append(
            baseline
            + SCALE
            * sum(
                weight(day)
                for day_index, day in enumerate(days)
                if counts(day)
                for role in roles
                if (day_index, role, member_index) in variables
            )
        )
    if len(deviations) < 2:
        return None

    # Exactly one person holds each `(day, role)` slot, so once `horizon_total`
    # counts slots and not days - true for the single-role lenses and for
    # `weekends` and `holidays` too - the deviations sum to a constant and
    # their mean is known before solving.
    mean = round((sum(baselines) + SCALE * horizon_total) / len(deviations))
    lower_bound = min(baselines)
    upper_bound = max(upper_bounds)
    span = max(1, upper_bound - lower_bound)
    return _Lens(
        definition.label,
        tuple(deviations),
        mean,
        span,
        lower_bound,
        upper_bound,
        definition.graded,
    )


def _fairness_lens_definitions(context: _ModelBuildContext) -> tuple[_LensDefinition, ...]:
    """The five lenses the objective levels, in the order it builds them."""
    members = context.members
    holidays = context.holidays
    historical_points = context.historical_points
    historical_lenses = context.historical_lenses or {}

    definitions = [
        # Decision D1: when anchored, the 11-19 lens leaves the range family.
        # The hard anchor ties the shift count to the anchor role's
        # weekday duties, and that role is balanced in points - a weekend duty
        # is 2 points and zero shifts, a Wednesday duty 1 point and one shift -
        # so both targets cannot be levelled at once: CP-SAT proves the 3-point
        # criterion infeasible in half a second and the floor for this roster is
        # 6 points. The lens therefore keeps only its distribution terms as a
        # tie-breaker, priced by TIE_BREAK_FRACTION; the measured price is zero,
        # so today it leaves the objective entirely and only the anchor's own
        # lenses fight for the criterion. With `independent` there is no anchor
        # and the lens keeps full rights.
        _LensDefinition(
            label=role.value,
            roles=(role,),
            counts=partial(_role_counts_day, role, holidays=holidays),
            weight=partial(_role_day_weight, role, holidays=holidays),
            historical={
                member.name: historical_points.get((member.name, role), 0.0) for member in members
            },
            graded=(
                role != AssignmentRole.late_shift
                or context.late_shift_anchor == LateShiftAnchor.independent
            ),
        )
        for role in AssignmentRole
    ]
    # The same two lenses the fairness report shows, defined so that a holiday
    # falling at a weekend is counted once, as a weekend.
    definitions.append(
        _LensDefinition(
            label="weekends",
            roles=ONCALL_ROLES,
            counts=lambda day: day.weekday() >= 5,
            weight=lambda _day: 1,
            historical={
                member.name: historical_lenses.get((member.name, "weekends"), 0.0)
                for member in members
            },
        )
    )
    definitions.append(
        _LensDefinition(
            label="holidays",
            roles=ONCALL_ROLES,
            counts=lambda day: day.weekday() < 5 and day in holidays,
            weight=lambda _day: 1,
            historical={
                member.name: historical_lenses.get((member.name, "holidays"), 0.0)
                for member in members
            },
        )
    )
    return tuple(definitions)


def _fairness_lenses(
    context: _ModelBuildContext, coverage: _CoverageModel, history_days: list[date]
) -> tuple[_Lens, ...]:
    """Every fairness lens that has something to level, in definition order."""
    return tuple(
        lens
        for definition in _fairness_lens_definitions(context)
        if (lens := _fairness_lens(context, coverage, definition, history_days)) is not None
    )


def _hinted_load(
    context: _ModelBuildContext, history_days: list[date]
) -> dict[tuple[int, AssignmentRole], float]:
    """How far ahead of their fair share each member starts, per role.

    The hint walk hands each slot to whoever is furthest behind, so this is the
    starting position it reads, and it is carried forward as the walk assigns.
    """
    members = context.members
    holidays = context.holidays
    historical_points = context.historical_points

    load: dict[tuple[int, AssignmentRole], float] = {}
    for role in AssignmentRole:
        role_history = {
            member.name: historical_points.get((member.name, role), 0.0) for member in members
        }
        total_points = sum(role_history.values())
        exposures = {
            member.name: slot_exposure(
                roles=(role,),
                window_start=history_days[0],
                window_end=history_days[-1],
                include=partial(_role_counts_day, role, holidays=holidays),
                weight=partial(_role_day_weight, role, holidays=holidays),
                is_eligible=member.eligible,
                is_unavailable=partial(_is_hard_unavailable, member),
            )
            if history_days
            else 0.0
            for member in members
        }
        total_exposure = sum(exposures.values())
        for member_index, member in enumerate(members):
            expected = (
                total_points * exposures[member.name] / total_exposure if total_exposure else 0.0
            )
            load[(member_index, role)] = role_history[member.name] - expected
    return load


def _add_deterministic_hints(
    context: _ModelBuildContext,
    coverage: _CoverageModel,
    history_days: list[date],
    anchor_role: AssignmentRole,
) -> None:
    """Hand CP-SAT a complete starting assignment, chosen the same way twice.

    Every tie is broken by an explicit ordering rather than by search order, so
    two runs over identical inputs start from the same solution (decision D-04).
    The roles are walked in a fixed order because 11-19 follows whoever the
    anchor role already picked for that day, and the anchor has to be picked
    first.
    """
    model = coverage.model
    days = coverage.days
    variables = coverage.variables
    members = context.members
    holidays = context.holidays
    prior_oncall = context.prior_oncall or {}
    late_shift_anchor = context.late_shift_anchor

    # Start every assignment variable at zero, then select one candidate per
    # distinct slot. Weekend/holiday block variables occur under several days;
    # their variable signature makes the block one round-robin decision.
    hinted_values = {variable.index: (variable, 0) for variable in variables.values()}
    chosen_members: dict[tuple[int, AssignmentRole], int] = {}
    processed_slots: set[tuple[int, ...]] = set()
    hinted_load = _hinted_load(context, history_days)

    def hint_role(role: AssignmentRole) -> None:
        for day_index in range(len(days)):
            candidates = [
                (member_index, variable)
                for member_index in range(len(members))
                if (variable := variables.get((day_index, role, member_index))) is not None
            ]
            if not candidates:
                continue
            signature = tuple(sorted(variable.index for _index, variable in candidates))
            if signature in processed_slots:
                continue
            processed_slots.add(signature)
            if (
                role == AssignmentRole.late_shift
                and late_shift_anchor != LateShiftAnchor.independent
            ):
                anchored = chosen_members.get((day_index, anchor_role))
                selected = next(
                    ((index, variable) for index, variable in candidates if index == anchored),
                    None,
                )
            else:
                selected = None
            if selected is None:

                def candidate_score(
                    candidate: tuple[int, cp_model.IntVar], current_day: int = day_index
                ) -> tuple[float, int, int]:
                    member_index, _variable = candidate
                    same_day_primary = int(
                        role == AssignmentRole.secondary
                        and member_index
                        == chosen_members.get((current_day, AssignmentRole.primary))
                    )
                    recent = sum(
                        chosen_members.get((earlier, role)) == member_index
                        for earlier in range(max(0, current_day - 3), current_day)
                    )
                    prior_recent = sum(
                        day in prior_oncall.get(members[member_index].name, set())
                        for day in days[max(0, current_day - 3) : current_day]
                    )
                    return (
                        hinted_load[(member_index, role)],
                        same_day_primary * 100 + recent + prior_recent,
                        member_index,
                    )

                selected = min(candidates, key=candidate_score)
            hinted_values[selected[1].index] = (selected[1], 1)
            hinted_load[(selected[0], role)] += _role_day_weight(role, days[day_index], holidays)
            for affected_day, affected_role, affected_member in variables:
                if (
                    affected_role == role
                    and affected_member == selected[0]
                    and variables[(affected_day, affected_role, affected_member)].index
                    == selected[1].index
                ):
                    chosen_members[(affected_day, role)] = selected[0]

    hint_role(AssignmentRole.primary)
    hint_role(AssignmentRole.secondary)
    hint_role(AssignmentRole.late_shift)
    for variable, value in hinted_values.values():
        model.add_hint(variable, value)


def _build_model_from_context(
    context: _ModelBuildContext,
    *,
    spacing: bool,
    acceptance_cap: int | None = None,
    fairness_only: bool = False,
    fairness_bound: int | None = None,
) -> _BuiltModel:
    """One complete CP-SAT model.

    Returns ``(model, variables, conflicts, lenses)``; ``lenses`` is empty when
    ``conflicts`` is non-empty (the model is not finished in that case).

    ``spacing`` decides whether the 3-duties-in-7-days and rest-after-run
    rules are compiled into the model as hard constraints. Building two distinct
    models - rather than switching the rules on with CP-SAT assumptions - is
    what lets the fallback pass in :func:`generate_schedule` stay fully
    multi-threaded; assumptions force the whole search to a single thread and
    gut presolve.

    ``acceptance_cap``, when set, bounds every graded lens range to that many
    points as a hard constraint, turning the acceptance criterion into
    something the model guarantees rather than something the objective hopes
    for.
    """
    starts_on = context.starts_on
    history_window = context.history_window
    fairness_weight = context.fairness_weight
    continuity_weight = context.continuity_weight
    preference_weight = context.preference_weight
    coverage = _build_coverage(context)
    model = coverage.model
    variables = coverage.variables
    conflicts = coverage.conflicts

    if conflicts:
        return model, variables, conflicts, []

    oncall_by_day_member = _add_rest_constraints(context, coverage, spacing=spacing)

    fairness_terms: list[_Term] = []
    preference_terms: list[_Term] = []
    continuity_terms: list[_Term] = []
    weekly_spacing_terms: list[_Term] = []
    lenses: list[_Lens] = []

    weekly_spacing_terms.extend(_add_weekly_spacing_terms(context, coverage, oncall_by_day_member))

    preference_terms.extend(_assignment_preference_terms(context, coverage))

    # The window `historical_points` was measured over: exposure has to be
    # counted over exactly that window, or somebody's expected share is computed
    # against a different span than their actual duties.
    history_days = _days(
        *(history_window or (starts_on - timedelta(days=365), starts_on - timedelta(days=1)))
    )

    lenses.extend(_fairness_lenses(context, coverage, history_days))

    continuity_terms.extend(_add_continuity_terms(context, coverage))

    late_shift_coupling = _add_late_shift_coupling(context, coverage)
    anchor_role = late_shift_coupling.anchor_role
    preference_terms.extend(late_shift_coupling.preference_terms)

    # Range and distribution are optimized in the same pass. Inequalities are
    # enough for max/min because the objective closes both bounds. A lens that
    # is not graded leaves the range family: no max/min variables at all, so
    # the model carries no dead variables, and its distribution terms are
    # priced separately as a tie-breaker (decision D1).
    tie_break_terms: list[_Term] = []
    for lens in lenses:
        if lens.graded:
            maximum = model.new_int_var(lens.lower_bound, lens.upper_bound, f"max_{lens.label}")
            minimum = model.new_int_var(lens.lower_bound, lens.upper_bound, f"min_{lens.label}")
            for deviation in lens.deviations:
                model.add(maximum >= deviation)
                model.add(minimum <= deviation)
            if acceptance_cap is not None:
                model.add(maximum - minimum <= acceptance_cap * SCALE)
            # The range is used raw: at its maximum it contributes one `span`
            # per lens, the same order as every normalized spread term below.
            fairness_terms.append(maximum - minimum)
        elif not TIE_BREAK_FRACTION:
            # The measured tie-break price is zero: a lens that cannot bid into
            # the objective gets no variables either.
            continue

        tangent_step = max(1, ceil(lens.span / min(16, lens.span)))
        tangents = list(range(0, lens.span, tangent_step))[:15]
        if lens.span - 1 not in tangents:
            tangents.append(lens.span - 1)
        for index, projected in enumerate(lens.deviations):
            distance = model.new_int_var(0, lens.span, f"distance_{lens.label}_{index}")
            model.add_abs_equality(distance, projected - lens.mean)
            # Squares normalized by their own span, so every fairness term stays
            # order `span` instead of `span^2`. With the unscaled squares the
            # family's true maximum grew quadratically with the horizon, the
            # coefficients exploded into the millions, and the LP
            # relaxation degraded (tens of thousands of failed pivots).
            spread = model.new_int_var(0, lens.span, f"spread_{lens.label}_{index}")
            for k in tangents:
                model.add(lens.span * spread >= (2 * k + 1) * distance - k * (k + 1))
            (fairness_terms if lens.graded else tie_break_terms).append(spread)

    fairness_cost = marginal_cost(fairness_weight, FAIRNESS_STEP)
    preference_cost = marginal_cost(preference_weight, 1)
    continuity_cost = marginal_cost(continuity_weight, 1)
    weekly_spacing_cost = marginal_cost(continuity_weight, 1)
    objective = [term * fairness_cost for term in fairness_terms]
    if tie_break_terms:
        tie_break_cost = max(1, round(fairness_cost * TIE_BREAK_FRACTION))
        objective.extend(term * tie_break_cost for term in tie_break_terms)
    objective.extend(term * preference_cost for term in preference_terms)
    objective.extend(term * continuity_cost for term in continuity_terms)
    objective.extend(term * weekly_spacing_cost for term in weekly_spacing_terms)

    _add_deterministic_hints(context, coverage, history_days, anchor_role)

    fairness_objective = sum(
        [term * fairness_cost for term in fairness_terms]
        + [term * max(1, round(fairness_cost * TIE_BREAK_FRACTION)) for term in tie_break_terms]
    )
    if fairness_bound is not None:
        model.add(fairness_objective <= fairness_bound)
    model.minimize(fairness_objective if fairness_only else sum(objective))
    return model, variables, conflicts, lenses


def _build_model(
    *,
    starts_on: date,
    ends_on: date,
    mode: RotationMode,
    members: list[SolverMember],
    historical_points: dict[tuple[str, AssignmentRole], float],
    holidays: set[date],
    historical_lenses: dict[tuple[str, str], float] | None,
    history_window: tuple[date, date] | None,
    fairness_weight: float,
    continuity_weight: float,
    preference_weight: float,
    late_shift_anchor: LateShiftAnchor,
    spacing: bool,
    prior_oncall: dict[str, set[date]] | None = None,
    acceptance_cap: int | None = None,
    fairness_only: bool = False,
    fairness_bound: int | None = None,
) -> _BuiltModel:
    """Compatibility entry point for focused model tests."""
    return _build_model_from_context(
        _ModelBuildContext(
            starts_on=starts_on,
            ends_on=ends_on,
            mode=mode,
            members=members,
            historical_points=historical_points,
            holidays=holidays,
            historical_lenses=historical_lenses,
            history_window=history_window,
            fairness_weight=fairness_weight,
            continuity_weight=continuity_weight,
            preference_weight=preference_weight,
            late_shift_anchor=late_shift_anchor,
            prior_oncall=prior_oncall,
        ),
        spacing=spacing,
        acceptance_cap=acceptance_cap,
        fairness_only=fairness_only,
        fairness_bound=fairness_bound,
    )


def _prior_history_warning(
    members: list[SolverMember],
    prior_oncall: dict[str, set[date]] | None,
    starts_on: date,
    holidays: set[date],
) -> str | None:
    """Whether the week before the horizon already breaks the rest rules.

    The generator cannot repair what happened before its range, only avoid
    deepening it, so this is reported rather than treated as a conflict.
    """
    prior_days = _days(starts_on - timedelta(days=6), starts_on - timedelta(days=1))
    prior_exempt = exempt_days(prior_days, holidays)
    held = prior_oncall or {}
    violated = any(
        oncall_rest_violations(member.name, held.get(member.name, set()), prior_exempt)
        for member in members
    )
    if not violated:
        return None
    return (
        "Historia przed początkiem zakresu już narusza reguły odpoczynku; "
        "generator ograniczył nowe dni bez pogłębiania zastanego naruszenia."
    )


@dataclass(frozen=True)
class _CriterionPass:
    """What the criterion pass leaves for the real solve to start from."""

    model: cp_model.CpModel
    variables: _AssignmentVariables
    #: True only when the criterion pass proved its own optimum, not merely
    #: found a solution: that is what makes the claim a proof.
    fairness_proven: bool


def _criterion_pass(
    model: cp_model.CpModel,
    variables: _AssignmentVariables,
    *,
    spacing: bool,
    solve_seconds: float,
    build: Callable[..., _BuiltModel],
    solve: Callable[..., tuple[cp_model.CpSolver, cp_model.CpSolverStatus]],
) -> _CriterionPass:
    """Solve fairness alone first, then hand the real model its answer.

    When the roster can meet the acceptance criterion, the real run keeps the
    cap and the criterion holds by construction rather than by luck of the
    search (decision D2). The fairness solution is transplanted as a hint, so
    the second pass starts where the first finished instead of from the
    round-robin hints the builder wrote.

    A short budget skips the whole thing: under ten seconds there is not enough
    time for two passes, and one complete pass beats two starved ones. The
    unchanged model is then returned as it came in.
    """
    if solve_seconds < 10:
        return _CriterionPass(model, variables, False)

    fairness_model, fairness_variables, fairness_conflicts, _ = build(
        spacing, ACCEPTANCE_POINTS, fairness_only=True
    )
    if fairness_conflicts:
        return _CriterionPass(model, variables, False)

    fairness_solver, fairness_status = solve(fairness_model, solve_seconds * 0.5)
    if fairness_status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return _CriterionPass(model, variables, False)

    fairness_proven = fairness_status == cp_model.OPTIMAL
    fairness_optimum = round(fairness_solver.objective_value) if fairness_proven else None
    bounded_model, bounded_variables, _conflicts, _ = build(
        spacing, ACCEPTANCE_POINTS, fairness_bound=fairness_optimum
    )
    bounded_model.clear_hints()  # type: ignore[no-untyped-call]
    phase_hints: dict[int, tuple[cp_model.IntVar, bool]] = {}
    for key, variable in bounded_variables.items():
        phase_hints[variable.index] = (
            variable,
            fairness_solver.boolean_value(fairness_variables[key]),
        )
    for variable, value in phase_hints.values():
        bounded_model.add_hint(variable, value)
    return _CriterionPass(bounded_model, bounded_variables, fairness_proven)


@dataclass(frozen=True)
class _RecoveredSolve:
    """Where the infeasibility ladder left the run.

    It replaces the model, its variables, the solver and the status all at
    once, so they are returned together rather than reassigned one by one:
    a solution belongs to exactly one of the models tried, and pairing it with
    another one's variables would read a different schedule out of it.
    """

    model: cp_model.CpModel
    variables: _AssignmentVariables
    solver: cp_model.CpSolver
    status: cp_model.CpSolverStatus
    warnings: tuple[str, ...]
    acceptance_floor: int | None


def _recover_from_infeasible(
    *,
    spacing: bool,
    solve_seconds: float,
    spacing_suspended: str,
    build: Callable[..., _BuiltModel],
    solve: Callable[..., tuple[cp_model.CpSolver, cp_model.CpSolverStatus]],
    lowest_achievable_spread: Callable[[bool], int | None],
) -> _RecoveredSolve:
    """Find out which of three things blocked the run, and say so.

    Only meaningful after the main solve returned INFEASIBLE: every path here
    builds and solves a different model, so calling it on a run that succeeded
    would silently throw that run's solution away.

    The acceptance cap, the spacing rules or the coverage itself could be the
    blocker, and the coordinator needs to be told which. Dropping the cap first
    would answer nothing, so the cap is kept and the spacing rules are dropped:
    a solution then pins the blame on the spacing rules, another proof of
    infeasibility pins it on the criterion. Only in the second case is the cap
    abandoned, and then the lowest reachable spread is reported as a number
    rather than the run failing silently (decision D2).
    """
    if spacing:
        relaxed_model, relaxed_variables, relaxed_conflicts, _ = build(False, ACCEPTANCE_POINTS)
        relaxed_status: cp_model.CpSolverStatus = cp_model.INFEASIBLE
        relaxed_solver: cp_model.CpSolver | None = None
        if not relaxed_conflicts:
            relaxed_solver, relaxed_status = solve(relaxed_model, solve_seconds)
        if relaxed_solver is not None and relaxed_status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            # The criterion survives; only the spacing rules had to go.
            return _RecoveredSolve(
                relaxed_model,
                relaxed_variables,
                relaxed_solver,
                relaxed_status,
                (spacing_suspended,),
                None,
            )

    # The criterion itself is unattainable. Drop the cap and solve normally,
    # then report the lowest achievable spread. The spacing rules are suspended
    # only when they independently block coverage.
    warnings: list[str] = []
    model, variables, _, _ = build(spacing, None)
    solver, status = solve(model, solve_seconds)
    final_spacing = spacing
    if status == cp_model.INFEASIBLE and spacing:
        fallback_model, fallback_variables, _, _ = build(False, None)
        solver, status = solve(fallback_model, solve_seconds)
        model, variables = fallback_model, fallback_variables
        final_spacing = False
        if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            warnings.append(spacing_suspended)

    acceptance_floor: int | None = None
    if status in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        acceptance_floor = lowest_achievable_spread(final_spacing)
        if acceptance_floor is not None:
            warnings.append(
                f"Kryterium {ACCEPTANCE_POINTS} punktów rozpiętości jest "
                "nieosiągalne przy zastanym długu historycznym. Najniższa "
                f"osiągalna rozpiętość to {acceptance_floor} punktów - "
                "przyczyną jest zastana nierówność, nie jakość generowania."
            )
        else:
            warnings.append(
                f"Kryterium {ACCEPTANCE_POINTS} punktów rozpiętości jest "
                "nieosiągalne przy zastanym długu historycznym; nie "
                "udało się wyznaczyć najniższej osiągalnej rozpiętości."
            )
    return _RecoveredSolve(model, variables, solver, status, tuple(warnings), acceptance_floor)


def _solution_assignments(
    solver: cp_model.CpSolver,
    variables: _AssignmentVariables,
    days: list[date],
    members: list[SolverMember],
) -> list[GeneratedAssignment]:
    """The solved model read back as duties, in calendar then role order."""
    return sorted(
        (
            GeneratedAssignment(days[day_index], role, members[member_index].name)
            for (day_index, role, member_index), variable in variables.items()
            if solver.boolean_value(variable)
        ),
        key=lambda item: (item.service_date, item.role.value),
    )


def _failure_result(
    status: cp_model.CpSolverStatus,
    status_name: str,
    solve_seconds: float,
    warnings: tuple[str, ...],
) -> SolverResult:
    """What to tell the coordinator when no schedule came back.

    Running out of time and being genuinely over-constrained look the same in
    the result but need opposite advice, so they are never merged into one
    message.
    """
    if status == cp_model.UNKNOWN:
        budget_label = f"{total_time_budget(solve_seconds):.6f}".rstrip("0").rstrip(".")
        conflicts = (
            f"Solver nie zdążył znaleźć kompletnego grafiku w {budget_label} s "
            "(pełny limit generowania). Dane nie wskazują na konflikt reguł. "
            "Spróbuj krótszego zakresu albo zwiększ budżet czasu w ustawieniach "
            "generowania.",
        )
        reason = "UNKNOWN"
    else:
        conflicts = (
            "Ograniczenia pokrycia, eligibility, rozłączności ról, bloków dni "
            "wolnych lub limitu kolejnych dyżurów są wzajemnie sprzeczne.",
        )
        reason = "INFEASIBLE"
    return SolverResult((), conflicts, status_name, warnings=warnings, failure_reason=reason)


def _hard_unavailability_conflict(
    assignments: list[GeneratedAssignment], members: list[SolverMember]
) -> str | None:
    """A duty handed to somebody who declared the day unavailable, if any.

    Hard unavailability is a rule, not a preference: the model drops such
    members from the candidate set, so a duty reaching here means the model
    itself regressed. That has to surface loudly rather than be stored and
    published quietly, which is why it is checked again after solving.
    """
    members_by_name = {member.name: member for member in members}
    for assignment in assignments:
        member = members_by_name.get(assignment.assignee_name)
        if member is None:
            continue
        if member.preference(assignment.service_date) == AvailabilityKind.unavailable:
            return (
                f"{assignment.service_date.isoformat()} · {assignment.role.value}: "
                f"przypisano osobę z twardą niedostępnością ({assignment.assignee_name})"
            )
    return None


def _anchor_exceptions(
    assignments: list[GeneratedAssignment],
    days: list[date],
    late_shift_anchor: LateShiftAnchor,
) -> tuple[str, ...]:
    """Days where 11-19 could not follow its anchor role, named for the report.

    A member eligible for the anchor but not for 11-19 is still usable on the
    anchor, at a soft cost; the pairing then visibly breaks and the coordinator
    is told which day and who took the shift instead.
    """
    if late_shift_anchor == LateShiftAnchor.independent:
        return ()
    anchor_role = (
        AssignmentRole.primary
        if late_shift_anchor == LateShiftAnchor.primary
        else AssignmentRole.secondary
    )
    assignments_by_slot = {
        (item.service_date, item.role): item.assignee_name for item in assignments
    }
    exceptions = []
    for day in days:
        anchor_name = assignments_by_slot.get((day, anchor_role))
        late_name = assignments_by_slot.get((day, AssignmentRole.late_shift))
        if anchor_name is not None and late_name is not None and anchor_name != late_name:
            exceptions.append(
                f"{day.isoformat()}: {ROLE_LABELS[anchor_role]} ({anchor_name}) "
                f"nie może objąć zmiany 11–19; przypisano {late_name}"
            )
    return tuple(exceptions)


def generate_schedule(
    *,
    starts_on: date,
    ends_on: date,
    mode: RotationMode,
    members: list[SolverMember],
    historical_points: dict[tuple[str, AssignmentRole], float],
    holidays: set[date],
    historical_lenses: dict[tuple[str, str], float] | None = None,
    prior_oncall: dict[str, set[date]] | None = None,
    history_window: tuple[date, date] | None = None,
    fairness_weight: float = 3.0,
    continuity_weight: float = 1.0,
    preference_weight: float = 2.0,
    late_shift_anchor: LateShiftAnchor = LateShiftAnchor.secondary,
    solver_workers: int | None = None,
    solve_seconds: float = SOLVE_SECONDS,
    log_search_progress: bool = False,
    progress_callback: Callable[[str], None] | None = None,
) -> SolverResult:
    days = _days(starts_on, ends_on)
    context = _ModelBuildContext(
        starts_on=starts_on,
        ends_on=ends_on,
        mode=mode,
        members=members,
        historical_points=historical_points,
        holidays=holidays,
        historical_lenses=historical_lenses,
        prior_oncall=prior_oncall,
        history_window=history_window,
        fairness_weight=fairness_weight,
        continuity_weight=continuity_weight,
        preference_weight=preference_weight,
        late_shift_anchor=late_shift_anchor,
    )
    spacing = mode != RotationMode.weekly

    def build(
        spacing_rules: bool,
        cap_points: int | None,
        *,
        fairness_only: bool = False,
        fairness_bound: int | None = None,
    ) -> _BuiltModel:
        return _build_model_from_context(
            context,
            spacing=spacing_rules,
            acceptance_cap=cap_points,
            fairness_only=fairness_only,
            fairness_bound=fairness_bound,
        )

    model, variables, conflicts, _lenses = build(spacing, ACCEPTANCE_POINTS)
    if conflicts:
        return SolverResult((), tuple(conflicts), "INFEASIBLE", failure_reason="PRECHECK")

    # The whole run must fit one wall-clock ceiling, not `solve_seconds` per
    # pass with no bound on the count. Every `solve` call is handed the
    # smaller of its own budget and the time still left before the deadline;
    # the deadline itself keeps back a reserve for the orchestration
    # around the solver, and never drops below one full pass.
    deadline = time.monotonic() + max(
        solve_seconds,
        total_time_budget(solve_seconds) - GENERATION_ORCHESTRATION_RESERVE,
    )

    def time_left() -> float:
        return deadline - time.monotonic()

    def solve(
        model: cp_model.CpModel,
        seconds: float,
        *,
        feasibility_only: bool = False,
    ) -> tuple[cp_model.CpSolver, cp_model.CpSolverStatus]:
        budget = max(0.05, min(300.0, seconds, time_left()))
        if progress_callback is not None:
            # One event per solver pass, carrying that pass's budget. A hard
            # model is solved several times over - the criterion pass, the
            # spacing fallback, then the bisection that finds the floor - so
            # the budget of a single pass is not what the run costs, and a
            # progress bar scaled to it would pin long before the end.
            progress_callback(f"{SOLVE_PASS} {budget:g}")
        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = budget
        # ``num_search_workers`` is deprecated since OR-Tools 9.15; setting
        # both it and ``num_workers`` makes the model invalid.
        solver.parameters.num_workers = solver_workers or available_cpu_count()
        solver.parameters.linearization_level = 2
        solver.parameters.log_search_progress = log_search_progress
        solver.parameters.stop_after_first_solution = feasibility_only
        status = solver.solve(model)
        return solver, status

    def cap_feasible(spacing_rules: bool, cap_points: int) -> bool:
        probe_model, _probe_variables, probe_conflicts, _ = build(spacing_rules, cap_points)
        if probe_conflicts:
            return False
        _probe, probe_status = solve(probe_model, FLOOR_PROBE_SECONDS, feasibility_only=True)
        return probe_status in (cp_model.OPTIMAL, cp_model.FEASIBLE)

    def lowest_achievable_spread(spacing_rules: bool) -> int | None:
        """Lowest per-lens cap the roster can still meet, above the criterion.

        Only called after the criterion itself was proven infeasible on the
        same spacing, so the bisection always starts one point above it. It
        draws on whatever budget the earlier passes left: a starved probe would
        report a wrong floor, and the warning states that number as fact, so
        the search stops and returns None once the time runs low.
        """
        if time_left() < MIN_PASS_SECONDS:
            return None
        if not cap_feasible(spacing_rules, FLOOR_PROBE_MAX_POINTS):
            return None
        low, high = ACCEPTANCE_POINTS + 1, FLOOR_PROBE_MAX_POINTS
        while low < high:
            if time_left() < MIN_PASS_SECONDS:
                return None
            mid = (low + high) // 2
            if cap_feasible(spacing_rules, mid):
                high = mid
            else:
                low = mid + 1
        return low

    if progress_callback is not None:
        progress_callback(MODEL_BUILT)

    warnings: list[str] = []
    prior_warning = _prior_history_warning(members, prior_oncall, starts_on, holidays)
    if prior_warning is not None:
        warnings.append(prior_warning)
    acceptance_floor: int | None = None
    spacing_suspended = (
        "Reguły rozrzedzania musiały zostać zawieszone, bo przy tej "
        "obsadzie i nieobecnościach nie da się ich spełnić."
    )

    phase_started = time.monotonic()
    criterion = _criterion_pass(
        model,
        variables,
        spacing=spacing,
        solve_seconds=solve_seconds,
        build=build,
        solve=solve,
    )
    model, variables = criterion.model, criterion.variables
    fairness_proven = criterion.fairness_proven
    phase_elapsed = time.monotonic() - phase_started
    solver, status = solve(model, max(0.05, solve_seconds - phase_elapsed))

    if status == cp_model.INFEASIBLE:
        recovered = _recover_from_infeasible(
            spacing=spacing,
            solve_seconds=solve_seconds,
            spacing_suspended=spacing_suspended,
            build=build,
            solve=solve,
            lowest_achievable_spread=lowest_achievable_spread,
        )
        model, variables = recovered.model, recovered.variables
        solver, status = recovered.solver, recovered.status
        warnings.extend(recovered.warnings)
        acceptance_floor = recovered.acceptance_floor

    status_name = solver.status_name(status)
    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        return _failure_result(status, status_name, solve_seconds, tuple(warnings))
    if progress_callback is not None:
        progress_callback(SOLVE_DONE)
    assignments = _solution_assignments(solver, variables, days, members)

    regression = _hard_unavailability_conflict(assignments, members)
    if regression is not None:
        return SolverResult(
            (),
            (regression,),
            "INFEASIBLE",
            warnings=tuple(warnings),
            failure_reason="INFEASIBLE",
        )

    return SolverResult(
        tuple(assignments),
        (),
        status_name,
        _anchor_exceptions(assignments, days, late_shift_anchor),
        tuple(warnings),
        acceptance_floor=acceptance_floor,
        fairness_proven=fairness_proven or status == cp_model.OPTIMAL,
        # This is the optimality gap of the complete objective. Keep the
        # persisted field for migration compatibility; clients label it as
        # overall solution quality rather than continuity alone.
        continuity_gap=_solution_gap(solver, status),
    )
