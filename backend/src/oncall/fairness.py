"""Fairness report computation.

Balances actual duties from published and superseded schedules over a rolling
12-month window. A weekday is worth 1 point (X); Saturdays, Sundays and
Polish statutory holidays are worth 2 points (2X) without cumulating
multipliers. Primary, secondary, weekends, holidays and 11-19 shifts are
balanced separately. The expected share of every category is proportional
to the member's eligible days inside the window.

Lens definitions: ``weekends`` counts on-call (primary/secondary) duties on
Saturdays and Sundays; ``holidays`` counts on-call duties on statutory
holidays that fall on a weekday, so the two lenses never double-count a day.
"""

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, timedelta

from oncall.domain.vocabulary import AssignmentRole

ONCALL_ROLES = (AssignmentRole.primary, AssignmentRole.secondary)

#: Acceptance criterion from archive/docs/PLAN.md par. 3, in points: the spread of
#: every graded lens must fit in this many points. It lives here, next to the
#: report that defines the product metric, and the solver imports it so the
#: threshold exists in exactly one place.
ACCEPTANCE_POINTS = 3

LENSES = ("primary", "secondary", "late_shift", "weekends", "holidays")


def graded_lenses(late_shift_balanced: bool) -> tuple[str, ...]:
    """The lenses the acceptance criterion covers.

    Decision D1: the 11-19 shift has a criterion only with the `independent`
    anchor; when anchored its count follows the anchor role and the lens drops
    out of the spread family.
    """
    if late_shift_balanced:
        return LENSES
    return tuple(lens for lens in LENSES if lens != "late_shift")


def criterion_member_ids(members: list[FairnessMemberInput], as_of: date) -> set[uuid.UUID]:
    """People who belong to the acceptance population on the boundary date."""
    return {
        member.id
        for member in members
        if member.active_from <= as_of
        and (member.active_until is None or member.active_until >= as_of)
    }


def lens_spread(
    members: list[MemberBalance],
    lens: str,
    criterion_ids: set[uuid.UUID] | None = None,
) -> float:
    """How far apart the most- and least-served member are on one lens."""
    deviations = [
        getattr(member, lens).deviation
        for member in members
        if criterion_ids is None or member.member_id in criterion_ids
    ]
    if not deviations:
        return 0.0
    return round(max(deviations) - min(deviations), 2)


@dataclass
class EligibilityPeriod:
    starts_on: date
    ends_on: date | None


@dataclass
class FairnessMemberInput:
    id: uuid.UUID
    display_name: str
    active_from: date
    active_until: date | None
    eligibility: dict[AssignmentRole, list[EligibilityPeriod]] = field(default_factory=dict)
    #: Hard-unavailability ranges (inclusive). Decision D3, variant B: these days
    #: are dropped from the expected share, so a holiday lowers what the member
    #: is owed instead of building a debt to repay - matching what the solver
    #: already does with its decision variables.
    unavailable_periods: list[tuple[date, date]] = field(default_factory=list)


@dataclass
class FairnessDuty:
    service_date: date
    role: AssignmentRole
    assignee_name: str
    #: Preferred over the name; None for imported rows and pre-migration data.
    member_id: uuid.UUID | None = None


@dataclass
class CategoryBalance:
    actual: float
    expected: float
    deviation: float


@dataclass
class MemberBalance:
    member_id: uuid.UUID
    display_name: str
    #: When the member joined the rotation. Lets the screen explain a low
    #: absolute total that is nonetheless in line with the fair share, because
    #: the person was only eligible for part of the window.
    active_from: date
    eligible_days: dict[str, int]
    primary: CategoryBalance
    secondary: CategoryBalance
    late_shift: CategoryBalance
    weekends: CategoryBalance
    holidays: CategoryBalance
    total_points: float


@dataclass
class FairnessComputation:
    totals: dict[str, float]
    members: list[MemberBalance]


def day_weight(day: date, holidays: set[date]) -> float:
    return 2.0 if day.weekday() >= 5 or day in holidays else 1.0


def _member_unavailable(member: FairnessMemberInput, day: date) -> bool:
    return any(start <= day <= end for start, end in member.unavailable_periods)


def _member_eligible(member: FairnessMemberInput, role: AssignmentRole, day: date) -> bool:
    if member.active_from > day or (member.active_until is not None and day > member.active_until):
        return False
    return any(
        period.starts_on <= day and (period.ends_on is None or day <= period.ends_on)
        for period in member.eligibility.get(role, [])
    )


def slot_exposure(
    *,
    roles: tuple[AssignmentRole, ...],
    window_start: date,
    window_end: date,
    include: Callable[[date], bool],
    weight: Callable[[date], float],
    is_eligible: Callable[[AssignmentRole, date], bool],
    is_unavailable: Callable[[date], bool],
) -> float:
    """A member's exposure to one lens: the weighted count of ``(day, role)``
    slots they could have held.

    The single expected-share formula for both the fairness report and
    ``scheduler.balance``. It counts one slot per role the
    member is eligible for that day - two for the ``weekends``/``holidays``
    lenses, which span both on-call roles - and drops hard-unavailable days
    (decision D3, variant B).
    """
    total = 0.0
    for offset in range((window_end - window_start).days + 1):
        day = window_start + timedelta(days=offset)
        if include(day) and not is_unavailable(day):
            total += weight(day) * sum(1 for role in roles if is_eligible(role, day))
    return total


def _count_eligible_days(
    member: FairnessMemberInput,
    roles: tuple[AssignmentRole, ...],
    window_start: date,
    window_end: date,
) -> int:
    """Days in the window the member is active and eligible for a role.

    This is a membership/tenure figure - "days you belonged to this rotation" -
    and drives the "does not hold this role" gate on the fairness screen. It does not
    net out hard-unavailability: decision D3 (variant B) touches the expected
    *share* only, and that lives in ``slot_exposure``. Subtracting absence here
    would make a member who was away read as if they never held the role.
    """
    return sum(
        1
        for offset in range((window_end - window_start).days + 1)
        if any(
            _member_eligible(member, role, window_start + timedelta(days=offset)) for role in roles
        )
    )


def _eligible_exposure(
    member: FairnessMemberInput,
    roles: tuple[AssignmentRole, ...],
    window_start: date,
    window_end: date,
    *,
    include,
    weight,
) -> float:
    return slot_exposure(
        roles=roles,
        window_start=window_start,
        window_end=window_end,
        include=include,
        weight=weight,
        is_eligible=lambda role, day: _member_eligible(member, role, day),
        is_unavailable=lambda day: _member_unavailable(member, day),
    )


def _balance(actual: float, share: float, total: float) -> CategoryBalance:
    expected = round(share * total, 2)
    return CategoryBalance(
        actual=round(actual, 2),
        expected=expected,
        deviation=round(actual - expected, 2),
    )


def compute_fairness(
    members: list[FairnessMemberInput],
    duties: list[FairnessDuty],
    *,
    holidays: set[date],
    window_start: date,
    window_end: date,
) -> FairnessComputation:
    eligible: dict[uuid.UUID, dict[str, int]] = {}
    for member in members:
        eligible[member.id] = {
            "primary": _count_eligible_days(
                member, (AssignmentRole.primary,), window_start, window_end
            ),
            "secondary": _count_eligible_days(
                member, (AssignmentRole.secondary,), window_start, window_end
            ),
            "late_shift": _count_eligible_days(
                member, (AssignmentRole.late_shift,), window_start, window_end
            ),
            "oncall": _count_eligible_days(member, ONCALL_ROLES, window_start, window_end),
        }
    exposure = {
        member.id: {
            "primary": _eligible_exposure(
                member,
                (AssignmentRole.primary,),
                window_start,
                window_end,
                include=lambda _day: True,
                weight=lambda day: day_weight(day, holidays),
            ),
            "secondary": _eligible_exposure(
                member,
                (AssignmentRole.secondary,),
                window_start,
                window_end,
                include=lambda _day: True,
                weight=lambda day: day_weight(day, holidays),
            ),
            "late_shift": _eligible_exposure(
                member,
                (AssignmentRole.late_shift,),
                window_start,
                window_end,
                include=lambda day: day.weekday() < 5 and day not in holidays,
                weight=lambda _day: 1.0,
            ),
            "weekends": _eligible_exposure(
                member,
                ONCALL_ROLES,
                window_start,
                window_end,
                include=lambda day: day.weekday() >= 5,
                weight=lambda _day: 1.0,
            ),
            "holidays": _eligible_exposure(
                member,
                ONCALL_ROLES,
                window_start,
                window_end,
                include=lambda day: day.weekday() < 5 and day in holidays,
                weight=lambda _day: 1.0,
            ),
        }
        for member in members
    }
    total_exposure = {
        key: sum(member_exposure[key] for member_exposure in exposure.values())
        for key in ("primary", "secondary", "late_shift", "weekends", "holidays")
    }

    by_name = {member.display_name: member for member in members}
    actual: dict[uuid.UUID, dict[str, float]] = {
        member.id: {
            "primary": 0.0,
            "secondary": 0.0,
            "late_shift": 0.0,
            "weekends": 0.0,
            "holidays": 0.0,
        }
        for member in members
    }
    by_id = {member.id: member for member in members}
    for duty in duties:
        # Identity first so a rename cannot detach somebody from their history.
        member = (
            by_id.get(duty.member_id)
            if duty.member_id is not None
            else by_name.get(duty.assignee_name)
        )
        if member is None or not (window_start <= duty.service_date <= window_end):
            continue
        weight = day_weight(duty.service_date, holidays)
        bucket = actual[member.id]
        if duty.role in ONCALL_ROLES:
            bucket[duty.role.value] += weight
            if duty.service_date.weekday() >= 5:
                bucket["weekends"] += 1
            elif duty.service_date in holidays:
                bucket["holidays"] += 1
        else:
            bucket["late_shift"] += 1

    totals = {
        "primary_points": sum(bucket["primary"] for bucket in actual.values()),
        "secondary_points": sum(bucket["secondary"] for bucket in actual.values()),
        "late_shift_count": sum(bucket["late_shift"] for bucket in actual.values()),
        "weekend_duties": sum(bucket["weekends"] for bucket in actual.values()),
        "holiday_duties": sum(bucket["holidays"] for bucket in actual.values()),
    }

    def share(member_id: uuid.UUID, key: str) -> float:
        if total_exposure[key] == 0:
            return 0.0
        return exposure[member_id][key] / total_exposure[key]

    result: list[MemberBalance] = []
    for member in sorted(members, key=lambda item: item.display_name):
        bucket = actual[member.id]
        result.append(
            MemberBalance(
                member_id=member.id,
                display_name=member.display_name,
                active_from=member.active_from,
                eligible_days=eligible[member.id],
                primary=_balance(
                    bucket["primary"], share(member.id, "primary"), totals["primary_points"]
                ),
                secondary=_balance(
                    bucket["secondary"],
                    share(member.id, "secondary"),
                    totals["secondary_points"],
                ),
                late_shift=_balance(
                    bucket["late_shift"],
                    share(member.id, "late_shift"),
                    totals["late_shift_count"],
                ),
                weekends=_balance(
                    bucket["weekends"], share(member.id, "weekends"), totals["weekend_duties"]
                ),
                holidays=_balance(
                    bucket["holidays"], share(member.id, "holidays"), totals["holiday_duties"]
                ),
                total_points=round(
                    bucket["primary"] + bucket["secondary"] + bucket["late_shift"], 2
                ),
            )
        )
    return FairnessComputation(totals=totals, members=result)


def duty_points(
    duties: list[FairnessDuty],
    *,
    assignee_name: str,
    member_id: uuid.UUID | None = None,
    holidays: set[date],
    window_start: date,
    window_end: date,
) -> list[tuple[date, AssignmentRole, float, bool]]:
    """Per-duty breakdown for the drill-down view (date, role, points, is_day_off)."""
    result = []
    for duty in duties:
        if (
            duty.member_id != member_id
            if duty.member_id is not None and member_id is not None
            else duty.assignee_name != assignee_name
        ):
            continue
        if not (window_start <= duty.service_date <= window_end):
            continue
        is_day_off = duty.service_date.weekday() >= 5 or duty.service_date in holidays
        result.append(
            (duty.service_date, duty.role, day_weight(duty.service_date, holidays), is_day_off)
        )
    return sorted(result, key=lambda item: item[0], reverse=True)


WINDOW_DAYS = 365


def window(as_of: date) -> tuple[date, date]:
    """The rolling 12-month window ending on `as_of`."""
    return as_of - timedelta(days=WINDOW_DAYS), as_of


def history_window(starts_on: date) -> tuple[date, date]:
    """The window the generator scores a new horizon against.

    The same rolling 12 months the fairness report uses, ending the day before
    the horizon opens, so `#sprawiedliwosc` and the generator can never disagree
    about what somebody has already served.
    """
    return window(starts_on - timedelta(days=1))


def generator_history_window(starts_on: date, ends_on: date) -> tuple[date, date]:
    """The history still inside the rolling window once the horizon closes.

    The fairness report and the draft impact preview measure in the rolling 12
    months ending on the last day of the draft, so the generator has to optimize
    against the history that window still contains. Anchoring the window at the
    horizon start instead fed the solver the oldest `len(horizon)` days of
    history that age out before anybody reads the report - the same assignments
    then scored a `secondary` spread of 4.18 in the solver's window and 9.0 in
    the report's.
    """
    return ends_on - timedelta(days=WINDOW_DAYS), starts_on - timedelta(days=1)


def project_duties(historical: list[FairnessDuty], draft: list[FairnessDuty]) -> list[FairnessDuty]:
    """Resolved history with the draft's slots substituted, not stacked on top.

    Same family as `reassign`: it forecasts the effect of a change nobody has
    committed. Publication resolves per `(service_date, role)` - regenerating an
    already-published fortnight replaces those slots - so a draft that overlaps
    published days must displace them. Adding the draft rows to the resolved
    history would count every shared day twice: the primary point sum in the
    forecast would rise by exactly the draft's own points.
    """
    overridden = {(duty.service_date, duty.role) for duty in draft}
    kept = [duty for duty in historical if (duty.service_date, duty.role) not in overridden]
    return kept + list(draft)


def reassign(
    duties: list[FairnessDuty],
    service_date: date,
    role: AssignmentRole,
    from_name: str,
    to_name: str,
    to_member_id: uuid.UUID | None = None,
) -> list[FairnessDuty]:
    """The same duty list with one slot moved to another person.

    Used to project what a swap does to the balance without writing anything.
    """
    return [
        FairnessDuty(
            service_date=duty.service_date,
            role=duty.role,
            assignee_name=to_name,
            member_id=to_member_id,
        )
        if duty.service_date == service_date
        and duty.role == role
        and duty.assignee_name == from_name
        else duty
        for duty in duties
    ]
