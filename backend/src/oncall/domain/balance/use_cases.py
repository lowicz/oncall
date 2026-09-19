"""The fairness report and its per-duty drill-down.

Coordinators and administrators see the whole team; a team member sees only
their own balance. Viewers see nothing, because points are private to the team.
"""

import uuid
from collections.abc import Callable

from oncall.domain.balance import errors
from oncall.domain.balance.models import (
    BalanceQuery,
    BalanceReport,
    DutyBreakdownQuery,
    DutyPoints,
    LensOutliers,
    LensSpread,
)
from oncall.domain.balance.ports import BalancePorts
from oncall.domain.errors import NotATeamMember
from oncall.domain.team import Actor
from oncall.domain.vocabulary import LateShiftAnchor, UserRole
from oncall.fairness import (
    ACCEPTANCE_POINTS,
    CategoryBalance,
    MemberBalance,
    compute_fairness,
    criterion_member_ids,
    duty_points,
    graded_lenses,
    lens_spread,
    window,
)
from oncall.workdays import polish_holidays


def _refuse_viewers(actor: Actor) -> None:
    if actor.role == UserRole.viewer:
        raise errors.PointsTeamOnly()


async def _own_member_id(actor: Actor, ports: BalancePorts) -> uuid.UUID:
    own = await ports.team.member_for_account(actor.user_id)
    if own is None:
        raise NotATeamMember()
    return own.id


def _by_deviation(lens: str) -> Callable[[MemberBalance], float]:
    """Order members by how far this lens leaves them from their fair share."""

    def deviation(item: MemberBalance) -> float:
        balance: CategoryBalance = getattr(item, lens)
        return balance.deviation

    return deviation


async def balance_report(query: BalanceQuery, ports: BalancePorts) -> BalanceReport:
    _refuse_viewers(query.actor)
    window_start, window_end = window(query.as_of)
    members, duties = await ports.history.balance_inputs(window_start, window_end)
    own_id = None if query.actor.coordinates else await _own_member_id(query.actor, ports)
    report = compute_fairness(
        members,
        duties,
        holidays=polish_holidays(window_start, window_end),
        window_start=window_start,
        window_end=window_end,
    )
    late_shift_balanced = await ports.policy.late_shift_anchor() == LateShiftAnchor.independent
    criterion_ids = criterion_member_ids(members, window_end)
    if own_id is None:
        visible = report.members
        totals = report.totals
        lenses = graded_lenses(late_shift_balanced)
        spreads = [
            LensSpread(
                lens=lens,
                spread=lens_spread(report.members, lens, criterion_ids),
                meets_criterion=lens_spread(report.members, lens, criterion_ids)
                <= ACCEPTANCE_POINTS,
            )
            for lens in lenses
        ]
        in_criterion = [item for item in report.members if item.member_id in criterion_ids]
        outliers = []
        for lens in lenses:
            ordered = sorted(in_criterion, key=_by_deviation(lens))
            outliers.append(
                LensOutliers(
                    lens=lens,
                    lowest=ordered[0] if ordered else None,
                    highest=ordered[-1] if ordered else None,
                )
            )
    else:
        visible = [member for member in report.members if member.member_id == own_id]
        own = visible[0]
        totals = {
            "primary_points": own.primary.actual,
            "secondary_points": own.secondary.actual,
            "late_shift_count": own.late_shift.actual,
            "weekend_duties": own.weekends.actual,
            "holiday_duties": own.holidays.actual,
        }
        spreads = []
        outliers = []
    return BalanceReport(
        as_of=query.as_of,
        window_start=window_start,
        window_end=window_end,
        totals=totals,
        members=visible,
        criterion_ids=criterion_ids,
        late_shift_balanced=late_shift_balanced,
        criterion_points=ACCEPTANCE_POINTS,
        spreads=spreads,
        outliers=outliers,
        latest_publish_end=await ports.publications.latest_publication_end(),
    )


async def duty_breakdown(query: DutyBreakdownQuery, ports: BalancePorts) -> list[DutyPoints]:
    _refuse_viewers(query.actor)
    if not query.actor.coordinates and await _own_member_id(query.actor, ports) != query.member_id:
        raise errors.OwnDutiesOnly(query.member_id)
    member = await ports.team.member(query.member_id)
    if member is None:
        raise errors.BalanceMemberNotFound(query.member_id)
    window_start, window_end = window(query.as_of)
    _, duties = await ports.history.balance_inputs(window_start, window_end)
    return [
        DutyPoints(*item)
        for item in duty_points(
            duties,
            assignee_name=member.display_name,
            member_id=member.id,
            holidays=polish_holidays(window_start, window_end),
            window_start=window_start,
            window_end=window_end,
        )
    ]
