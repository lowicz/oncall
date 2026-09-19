"""Which slots a swap moves, and which rule breaks it may bend."""

from datetime import date

from oncall.domain.roster import OPPOSITE_ONCALL, Duty, Slot, anchor_role
from oncall.domain.team import Member
from oncall.domain.vocabulary import AssignmentRole, LateShiftAnchor
from oncall.rules import RuleViolation
from oncall.workdays import is_working_day

#: Rules a swap bends but does not break. `day_off_block` is a warning on the
#: swap path exactly as it is on the coordinator override (decision D2); the
#: 11-19 anchor split is tolerated only when the replacement cannot hold 11-19,
#: so it is added per-request rather than listed here.
TOLERATED_SWAP_RULES = frozenset({"day_off_block", "oncall_late_shift_overlap"})


def partner_role(role: AssignmentRole, anchor: LateShiftAnchor) -> AssignmentRole | None:
    """The role that travels with `role` under the 11-19 anchor, if any."""
    bound = anchor_role(anchor)
    if role == bound:
        return AssignmentRole.late_shift
    if role == AssignmentRole.late_shift:
        return bound
    return None


def holds_partner(
    duties: dict[Slot, Duty],
    service_date: date,
    partner: AssignmentRole | None,
    member: Member,
) -> bool:
    return partner is not None and (
        (service_date, partner) in duties
        and duties[(service_date, partner)].held_by(member.id, member.display_name)
    )


def coupled_moves(
    *,
    service_date: date,
    role: AssignmentRole,
    anchor: LateShiftAnchor,
    holidays: set[date],
    requester_holds_partner: bool,
    replacement_eligible_for_partner: bool,
) -> tuple[list[Slot], bool]:
    """The slots a swap moves, and whether the 11-19 anchor exception applies.

    When the policy binds 11-19 to a role and the clicked slot is one of that
    pair on a working day, both slots move as one decision (decision D1). If the
    replacement is not eligible for 11-19, the shift stays with the requester
    and the resulting anchor split is a tolerated exception, exactly as the
    solver reports it.
    """
    moves = [(service_date, role)]
    bound = anchor_role(anchor)
    if bound is None or not is_working_day(service_date, holidays):
        return moves, False
    if role == bound:
        partner = AssignmentRole.late_shift
    elif role == AssignmentRole.late_shift:
        partner = bound
    else:
        return moves, False
    if not requester_holds_partner:
        return moves, False
    if partner == AssignmentRole.late_shift and not replacement_eligible_for_partner:
        return moves, True
    if replacement_eligible_for_partner:
        moves.append((service_date, partner))
    return moves, False


def moves_for(
    *,
    service_date: date,
    role: AssignmentRole,
    requester: Member,
    replacement: Member,
    duties: dict[Slot, Duty],
    anchor: LateShiftAnchor,
    holidays: set[date],
) -> tuple[list[Slot], bool]:
    """`coupled_moves` for two concrete people on the roster in force."""
    partner = partner_role(role, anchor)
    return coupled_moves(
        service_date=service_date,
        role=role,
        anchor=anchor,
        holidays=holidays,
        requester_holds_partner=holds_partner(duties, service_date, partner, requester),
        replacement_eligible_for_partner=partner is not None
        and replacement.is_eligible(partner, service_date),
    )


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


def has_anchor_exception(moves: list[Slot], anchor: LateShiftAnchor, holidays: set[date]) -> bool:
    """Whether the stored slot set decoupled 11-19 on purpose.

    `request_swap` leaves the 11-19 slot out of the move set only when the
    replacement cannot hold it, so on approval a day that moves the anchor role
    without its 11-19 partner is the tolerated exception, not a fresh break.
    """
    bound = anchor_role(anchor)
    if bound is None:
        return False
    move_set = set(moves)
    return any(
        role == bound
        and is_working_day(day, holidays)
        and (day, AssignmentRole.late_shift) not in move_set
        for day, role in moves
    )


def partition_violations(
    violations: list[RuleViolation], *, anchor_exception: bool
) -> tuple[list[RuleViolation], list[RuleViolation]]:
    """Split into rules that block the swap and rules it only bends."""
    tolerated = set(TOLERATED_SWAP_RULES)
    if anchor_exception:
        tolerated.add("late_shift_anchor")
    blocking = [item for item in violations if item.rule not in tolerated]
    warnings = [item for item in violations if item.rule in tolerated]
    return blocking, warnings
