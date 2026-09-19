"""The hard-rule checks, run against the roster in force.

One loader, shared by the swap path (block, decision D3) and the coordinator
override (warning plus audit): the same resolved roster the calendar matrix
shows, the same substitution, the same violations - so the two paths can
never disagree about what a slot move would break.
"""

from datetime import date

from oncall.domain.ports import PublishedRoster, RosterPolicy
from oncall.domain.roster import Slot, holder_names, rule_window
from oncall.domain.vocabulary import AssignmentRole
from oncall.rules import RuleViolation, batch_substitution_violations, substitution_violations
from oncall.workdays import polish_holidays


async def substitution_check(
    roster: PublishedRoster,
    policy: RosterPolicy,
    moves: list[Slot],
    from_name: str,
    to_name: str,
) -> list[RuleViolation]:
    """Hard rules that moving these slots to `to_name` would break.

    `moves` is a single slot for a plain swap or override, two when the 11-19
    anchor couples the shift to its role (decision D1).
    """
    if not moves:
        return []
    window_start, window_end = rule_window([day for day, _role in moves])
    duties = await roster.duties_in_force(window_start, window_end)
    anchor = await policy.late_shift_anchor()
    return substitution_violations(
        holder_names(duties),
        moves,
        from_name,
        to_name,
        anchor,
        polish_holidays(window_start, window_end),
        await policy.rotation_mode(),
    )


async def batch_substitution_check(
    roster: PublishedRoster,
    policy: RosterPolicy,
    moves: list[tuple[date, AssignmentRole, str]],
) -> list[RuleViolation]:
    if not moves:
        return []
    window_start, window_end = rule_window([day for day, _role, _replacement in moves])
    duties = await roster.duties_in_force(window_start, window_end)
    anchor = await policy.late_shift_anchor()
    return batch_substitution_violations(
        holder_names(duties),
        moves,
        anchor,
        polish_holidays(window_start, window_end),
        await policy.rotation_mode(),
    )
