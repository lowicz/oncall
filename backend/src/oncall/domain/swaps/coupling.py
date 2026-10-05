"""Which slots a swap moves, and what each rule it breaks means for it."""

from datetime import date

from oncall.domain.roster import OPPOSITE_ONCALL, Duty, Slot, anchor_role
from oncall.domain.swaps.models import SwapScope
from oncall.domain.team import Member
from oncall.domain.vocabulary import AssignmentRole, LateShiftAnchor
from oncall.rules import RuleViolation, merged
from oncall.workdays import is_working_day

#: Rules a swap bends but does not break. `day_off_block` is a warning on the
#: swap path exactly as it is on the coordinator override (decision D2); the
#: 11-19 anchor split is tolerated only when whoever takes the anchor role
#: cannot hold 11-19, so it is added per day rather than listed here.
TOLERATED_SWAP_RULES = frozenset({"day_off_block", "oncall_late_shift_overlap"})

#: Rules a swap may break, but only knowingly: the ones a coordinator's
#: correction may break with an acknowledgement. Whoever asks for the swap and
#: whoever lets it into the schedule each acknowledge them. Every other rule,
#: a new one included until it is listed here, refuses the swap outright.
ACKNOWLEDGEABLE_SWAP_RULES = frozenset(
    {"max_consecutive", "three_in_seven", "rest_after_run", "late_shift_anchor"}
)


def partner_role(role: AssignmentRole, anchor: LateShiftAnchor) -> AssignmentRole | None:
    """The role that travels with `role` under the 11-19 anchor, if any."""
    bound = anchor_role(anchor)
    if role == bound:
        return AssignmentRole.late_shift
    if role == AssignmentRole.late_shift:
        return bound
    return None


def holds_partner(
    duties: dict[Slot, Duty], service_date: date, partner: AssignmentRole, member: Member
) -> bool:
    return (service_date, partner) in duties and duties[(service_date, partner)].held_by(
        member.id, member.display_name
    )


def moves_for(
    *,
    service_date: date,
    role: AssignmentRole,
    requester: Member,
    replacement: Member,
    duties: dict[Slot, Duty],
    anchor: LateShiftAnchor,
    holidays: set[date],
    scope: SwapScope | None = None,
) -> list[Slot]:
    """The slots a swap of `role` on `service_date` moves from `requester` to
    `replacement`, the on-call role before its 11-19.

    `single` moves that slot alone. Otherwise, when the policy binds 11-19 to
    a role and the slot is one of that pair on a working day, both slots move
    as one decision (decision D1), the partner only if the replacement may
    hold it: an anchor role that leaves without its 11-19 is then the
    tolerated exception (`anchor_exception_days`). `whole` also takes the
    requester's other slot of the day when no anchor binds the two.
    """
    slot = (service_date, role)
    if scope == "single":
        return [slot]
    partner = partner_role(role, anchor) if is_working_day(service_date, holidays) else None
    if partner is not None and holds_partner(duties, service_date, partner, requester):
        eligible = replacement.is_eligible(partner, service_date)
        moves = [slot, (service_date, partner)] if eligible else [slot]
    elif scope == "whole":
        moves = [slot] + [
            other
            for other, duty in duties.items()
            if other[0] == service_date
            and other != slot
            and duty.held_by(requester.id, requester.display_name)
        ]
    else:
        moves = [slot]
    return sorted(moves, key=lambda move: move[1] == AssignmentRole.late_shift)


def takes_second_oncall(duties: dict[Slot, Duty], moves: list[Slot], member: Member) -> bool:
    """Whether accepting `moves` would give `member` both on-call roles on a day.

    The clicked-slot options filter only looks at the opposite of the clicked
    role; a coupled swap that also moves the anchor role needs the same check
    for that slot, or `request_swap` refuses a candidate the options offered.
    """
    for move_date, move_role in moves:
        opposite = OPPOSITE_ONCALL.get(move_role)
        if opposite is None:
            continue
        holder = duties.get((move_date, opposite))
        if holder is not None and holder.held_by(member.id, member.display_name):
            return True
    return False


def anchor_exception_days(
    moves: list[tuple[Slot, Member]], anchor: LateShiftAnchor, holidays: set[date]
) -> set[date]:
    """The days on which the anchor role moves without its 11-19 because
    whoever takes it cannot hold 11-19 that day: the tolerated exception, as
    the solver reports it. `moves` pairs every slot with the person taking it.
    A split the requester chose leaves the 11-19 with someone who could hold
    it, so it stays a broken rule to acknowledge.
    """
    bound = anchor_role(anchor)
    late_days = {day for (day, role), _taker in moves if role == AssignmentRole.late_shift}
    return {
        day
        for (day, role), taker in moves
        if role == bound
        and is_working_day(day, holidays)
        and day not in late_days
        and not taker.is_eligible(AssignmentRole.late_shift, day)
    }


def partition_violations(
    violations: list[RuleViolation], *, anchor_exception_days: set[date]
) -> tuple[list[RuleViolation], list[RuleViolation], list[RuleViolation]]:
    """Split into rules that refuse the swap, rules it breaks only with an
    acknowledgement (one entry per person and rule) and rules it only bends.
    The 11-19 anchor split is bent, not broken, on `anchor_exception_days`."""

    def tolerated(item: RuleViolation) -> bool:
        return item.rule in TOLERATED_SWAP_RULES or (
            item.rule == "late_shift_anchor" and anchor_exception_days.issuperset(item.days)
        )

    warnings = [item for item in violations if tolerated(item)]
    broken = [item for item in violations if not tolerated(item)]
    hard = [item for item in broken if item.rule not in ACKNOWLEDGEABLE_SWAP_RULES]
    to_acknowledge = [item for item in broken if item.rule in ACKNOWLEDGEABLE_SWAP_RULES]
    return hard, merged(to_acknowledge), warnings
