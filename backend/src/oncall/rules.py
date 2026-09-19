"""Hard roster rules as pure functions.

The solver states these rules as CP-SAT constraints, which makes them
unusable anywhere but inside the model - and every path after publication
needs to ask the same questions. This module is the one implementation the
swap path (block, decision D3), the coordinator override (warning plus audit)
and the draft warnings all read from, so the three can never disagree about
what a rule says. Nothing here
touches the database or raises HTTPException: functions return violations
and the caller decides whether that means 409 or a warning.
"""

from collections import Counter
from dataclasses import dataclass
from datetime import date, timedelta

from oncall.domain.vocabulary import AssignmentRole, LateShiftAnchor, RotationMode
from oncall.workdays import is_working_day

#: Imported back by the solver, so the constant also lives in exactly one place.
MAX_CONSECUTIVE_ONCALL_DAYS = 3

ONCALL_ROLES = (AssignmentRole.primary, AssignmentRole.secondary)

#: A slots map says who holds each roster slot: (day, role) -> assignee name.
Slots = dict[tuple[date, AssignmentRole], str]


@dataclass(frozen=True)
class RuleViolation:
    rule: str  #: Stable identifier, e.g. "three_in_seven"; goes to the audit log.
    message: str  #: One Polish sentence per rule, defined once here.
    member_name: str
    days: tuple[date, ...]


#: Days listed in a warning before it switches to a count. Six covers a full
#: over-loaded week; beyond that the sentence stops being readable.
LISTED_DAYS = 6


def _day_list(days: list[date]) -> str:
    shown = ", ".join(day.strftime("%d-%m-%Y") for day in days[:LISTED_DAYS])
    rest = len(days) - LISTED_DAYS
    return f"{shown} i {rest} więcej" if rest > 0 else shown


def describe(violation: RuleViolation) -> str:
    """The violation as one sentence naming who and when.

    `RuleViolation.message` states the rule alone, which is enough for an
    audit entry keyed by `rule` and `member_name`, but a warning on screen has
    no such key: without the name and the days it tells the coordinator that
    something is wrong somewhere.
    """
    return f"{violation.member_name}: {violation.message} Dni: {_day_list(list(violation.days))}."


def summarise(violations: list[RuleViolation]) -> list[str]:
    """One sentence per person and rule, over the union of the days involved.

    `oncall_rest_violations` reports one violation per starting day, so a
    single over-loaded fortnight yields a dozen overlapping windows. That is
    right for a check, which counts breaches, and unreadable as a warning
    list, which is read by a person.
    """
    grouped: dict[tuple[str, str], tuple[str, set[date]]] = {}
    for violation in violations:
        key = (violation.member_name, violation.rule)
        message, days = grouped.setdefault(key, (violation.message, set()))
        days.update(violation.days)
    return [
        describe(RuleViolation(rule, message, name, tuple(sorted(days))))
        for (name, rule), (message, days) in sorted(grouped.items())
    ]


def _day_off_blocks(days: list[date], holidays: set[date]) -> list[tuple[date, ...]]:
    """Runs of 2+ consecutive non-working days, as the solver sees them."""
    blocks: list[tuple[date, ...]] = []
    running: list[date] = []
    for day in days:
        if is_working_day(day, holidays):
            if len(running) >= 2:
                blocks.append(tuple(running))
            running = []
        else:
            running.append(day)
    if len(running) >= 2:
        blocks.append(tuple(running))
    return blocks


def exempt_days(days: list[date], holidays: set[date]) -> set[date]:
    """Days of over-long day-off blocks.

    A block longer than the consecutive-duty limit is one indivisible
    decision, so the solver leaves its days out of the rest windows and asks
    the holder to rest around it instead; the post-publication checks mirror
    that, or a Christmas block would read as a violation.
    """
    return {
        day
        for block in _day_off_blocks(days, holidays)
        if len(block) > MAX_CONSECUTIVE_ONCALL_DAYS
        for day in block
    }


def rest_rules_apply(mode: RotationMode | None) -> bool:
    """Whether the rolling rest rules are rules at all under this mode.

    Weekly rotation means one person carries a whole week, which is more than
    three consecutive days by construction, so the solver compiles none of
    these three constraints in that mode. An evaluator that reports them
    anyway reports the design as a defect: a clean weekly roster showed the
    coordinator five hard-rule warnings on every generation.

    A roster with no recorded mode - imported history, or a schedule from
    before the column existed - is judged by the full set.
    """
    return mode != RotationMode.weekly


def oncall_rest_violations(
    name: str,
    oncall_days: set[date],
    exempt_days: set[date] | None = None,
    *,
    mode: RotationMode | None = None,
) -> list[RuleViolation]:
    """Rest rules around on-call duty: at most 3 consecutive days, at most 3
    duties in any 7-day window, and 2 rest days after a run of 2+.

    All three are suspended under weekly rotation, which states no rest rule of
    its own - see `rest_rules_apply`.
    """
    if not rest_rules_apply(mode):
        return []
    exempt = exempt_days or set()
    served = sorted(oncall_days)
    violations: list[RuleViolation] = []

    for start in served:
        window = tuple(start + timedelta(days=offset) for offset in range(4))
        if all(day in oncall_days and day not in exempt for day in window):
            violations.append(
                RuleViolation(
                    "max_consecutive",
                    "Więcej niż 3 kolejne dni dyżuru on-call.",
                    name,
                    window,
                )
            )
        counted = tuple(
            day for day in served if start <= day <= start + timedelta(days=6) and day not in exempt
        )
        if start not in exempt and len(counted) > 3:
            violations.append(
                RuleViolation(
                    "three_in_seven",
                    "Więcej niż 3 dyżury on-call w okresie 7 dni.",
                    name,
                    counted,
                )
            )

    for first in served:
        second = first + timedelta(days=1)
        rest = first + timedelta(days=2)
        after = first + timedelta(days=3)
        if second not in oncall_days or rest in oncall_days or after not in oncall_days:
            continue
        if any(day in exempt for day in (first, second, rest, after)):
            continue
        violations.append(
            RuleViolation(
                "rest_after_run",
                "Mniej niż 2 dni przerwy po serii dyżurów on-call.",
                name,
                (first, second, after),
            )
        )
    return violations


def anchor_violations(
    name: str,
    slots: Slots,
    anchor: LateShiftAnchor,
    holidays: set[date],
) -> list[RuleViolation]:
    """The 11-19 shift stays with the anchor role: on a working day one
    person holds both. Only days involving `name` are flagged."""
    if anchor == LateShiftAnchor.independent:
        return []
    anchor_role = (
        AssignmentRole.primary if anchor == LateShiftAnchor.primary else AssignmentRole.secondary
    )
    violations: list[RuleViolation] = []
    for day in sorted({day for day, _role in slots}):
        if not is_working_day(day, holidays):
            continue
        anchor_holder = slots.get((day, anchor_role))
        late_holder = slots.get((day, AssignmentRole.late_shift))
        if anchor_holder == late_holder or name not in (anchor_holder, late_holder):
            continue
        violations.append(
            RuleViolation(
                "late_shift_anchor",
                "Zmiana 11–19 i rola kotwicząca są u różnych osób.",
                name,
                (day,),
            )
        )
    return violations


def day_off_block_violations(slots: Slots, holidays: set[date]) -> list[RuleViolation]:
    """A day-off block is one decision: one person per role across the whole
    block. Every holder of a partially held block is flagged, so callers can
    keep the violations involving their participants."""
    days = sorted({day for day, _role in slots})
    violations: list[RuleViolation] = []
    for block in _day_off_blocks(days, holidays):
        for role in ONCALL_ROLES:
            holders = {name for day in block if (name := slots.get((day, role))) is not None}
            if len(holders) < 2:
                continue
            for holder in sorted(holders):
                violations.append(
                    RuleViolation(
                        "day_off_block",
                        "Blok dni wolnych jest podzielony między osoby.",
                        holder,
                        block,
                    )
                )
    return violations


def late_shift_on_day_off(slots: Slots, holidays: set[date]) -> list[RuleViolation]:
    """The 11-19 shift exists on working days only."""
    return [
        RuleViolation(
            "late_shift_on_day_off",
            "Zmiana 11–19 przypada na dzień wolny od pracy.",
            holder,
            (day,),
        )
        for (day, role), holder in sorted(slots.items(), key=lambda item: item[0][0])
        if role == AssignmentRole.late_shift and not is_working_day(day, holidays)
    ]


def oncall_late_shift_overlap(slots: Slots, anchor: LateShiftAnchor) -> list[RuleViolation]:
    """Fatigue warning when one person carries on-call and 11-19 together.

    Only for the *non*-anchor on-call role: when the policy anchors 11-19 to
    a role (decision D1), the same person holding that role and 11-19 is the
    intended, designed-for state, not a violation - `anchor_violations` is
    what flags that pairing coming apart. Flagging it here as well would
    warn on every ordinary anchor-role correction and swap."""
    anchor_role = {
        LateShiftAnchor.primary: AssignmentRole.primary,
        LateShiftAnchor.secondary: AssignmentRole.secondary,
    }.get(anchor)
    watched_roles = [role for role in ONCALL_ROLES if role != anchor_role]
    result: list[RuleViolation] = []
    for day in sorted({day for day, _role in slots}):
        late_holder = slots.get((day, AssignmentRole.late_shift))
        if late_holder is None:
            continue
        if late_holder in {slots.get((day, role)) for role in watched_roles}:
            result.append(
                RuleViolation(
                    "oncall_late_shift_overlap",
                    "Ta sama osoba ma dyżur on-call i zmianę 11–19 tego dnia.",
                    late_holder,
                    (day,),
                )
            )
    return result


def _state_violations(
    slots: Slots,
    names: set[str],
    anchor: LateShiftAnchor,
    holidays: set[date],
    mode: RotationMode | None,
) -> list[RuleViolation]:
    """Every hard-rule violation involving any of `names` in one slot state."""
    days = sorted({day for day, _role in slots})
    exempt = exempt_days(days, holidays)
    violations: list[RuleViolation] = []
    for name in names:
        oncall_days = {
            day for (day, role), holder in slots.items() if holder == name and role in ONCALL_ROLES
        }
        violations += oncall_rest_violations(name, oncall_days, exempt, mode=mode)
        for day in days:
            if all(slots.get((day, role)) == name for role in ONCALL_ROLES):
                violations.append(
                    RuleViolation(
                        "same_day_oncall",
                        "Ta sama osoba ma oba dyżury on-call tego dnia.",
                        name,
                        (day,),
                    )
                )
        violations += anchor_violations(name, slots, anchor, holidays)
    violations += [
        violation
        for violation in day_off_block_violations(slots, holidays)
        if violation.member_name in names
    ]
    violations += [
        violation
        for violation in late_shift_on_day_off(slots, holidays)
        if violation.member_name in names
    ]
    violations += [
        violation
        for violation in oncall_late_shift_overlap(slots, anchor)
        if violation.member_name in names
    ]
    return violations


def substitution_violations(
    slots: Slots,
    moves: list[tuple[date, AssignmentRole]],
    from_name: str,
    to_name: str,
    anchor: LateShiftAnchor,
    holidays: set[date],
    mode: RotationMode | None = None,
) -> list[RuleViolation]:
    """Hard-rule violations that moving these slots would create.

    `moves` is one `(day, role)` for a plain swap and two when the 11-19 anchor
    couples the shift to its role (decision D1); every listed slot goes to
    `to_name` in the projected state.

    Only violations the move makes *more numerous* count: a roster already
    containing an accepted exception (for example somebody eligible for the
    anchor role but not for 11-19, or a deliberate override the coordinator
    was warned about) must not block unrelated edits of the same people.
    Matching is per (rule, person), so a pre-existing violation that merely
    moves to different days is not reported as new either.
    """
    names = {from_name, to_name}
    before = Counter(
        (violation.rule, violation.member_name)
        for violation in _state_violations(slots, names, anchor, holidays, mode)
    )
    projected = dict(slots)
    for day, role in moves:
        projected[(day, role)] = to_name
    created: list[RuleViolation] = []
    for violation in _state_violations(projected, names, anchor, holidays, mode):
        key = (violation.rule, violation.member_name)
        if before[key] > 0:
            before[key] -= 1
        else:
            created.append(violation)
    return created


def batch_substitution_violations(
    slots: Slots,
    moves: list[tuple[date, AssignmentRole, str]],
    anchor: LateShiftAnchor,
    holidays: set[date],
    mode: RotationMode | None = None,
) -> list[RuleViolation]:
    """Violations created by an atomic batch containing different recipients."""
    names = {
        name
        for day, role, replacement in moves
        for name in (slots.get((day, role)), replacement)
        if name is not None
    }
    before = Counter(
        (violation.rule, violation.member_name)
        for violation in _state_violations(slots, names, anchor, holidays, mode)
    )
    projected = dict(slots)
    for day, role, replacement in moves:
        projected[(day, role)] = replacement
    created: list[RuleViolation] = []
    for violation in _state_violations(projected, names, anchor, holidays, mode):
        key = (violation.rule, violation.member_name)
        if before[key] > 0:
            before[key] -= 1
        else:
            created.append(violation)
    return created
