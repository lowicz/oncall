"""Database-backed inputs for the fairness model.

`oncall.fairness` stays pure so it can be unit tested without a database; this
module is the thin loading layer shared by the fairness report and the swap
impact preview, so the window and the duty source stay identical between them.
"""

import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from oncall.domain.vocabulary import AvailabilityKind
from oncall.effective import effective_assignments, sorted_assignments
from oncall.fairness import (
    ONCALL_ROLES,
    CategoryBalance,
    EligibilityPeriod,
    FairnessDuty,
    FairnessMemberInput,
    MemberBalance,
    day_weight,
)

# Pure, so they live in `oncall.fairness` where the domain can reach them;
# re-exported because callers have always imported them from here.
from oncall.fairness import WINDOW_DAYS as WINDOW_DAYS
from oncall.fairness import generator_history_window as generator_history_window
from oncall.fairness import history_window as history_window
from oncall.fairness import project_duties as project_duties
from oncall.fairness import reassign as reassign
from oncall.fairness import window as window
from oncall.models import (
    AssignmentRole,
    Schedule,
    ScheduleStatus,
    TeamMember,
    User,
)
from oncall.presentation.reports import FairnessCategoryResponse, FairnessMemberResponse
from oncall.workdays import polish_holidays


async def latest_publish_end(db: AsyncSession) -> date | None:
    """The last day covered by the most recent published schedule.

    `/api/v1/schedules/published` cannot answer this: it caps its window at
    today + 90 days by design (LOW6-08), so a publication reaching further
    than that reports a truncated `ends_on`. The fairness screen needs the
    real date to default "Stan na dzień" to (QA7 par. 8, C2 review).
    """
    return await db.scalar(
        select(Schedule.ends_on)
        .where(Schedule.status == ScheduleStatus.published)
        .order_by(Schedule.ends_on.desc())
        .limit(1)
    )


def _unavailable_periods(member: TeamMember) -> list[tuple[date, date]]:
    """Hard-unavailability ranges for the fairness expected-share formula
    (decision D3, variant B). Soft preferences are not read here."""
    return [
        (entry.starts_on, entry.ends_on)
        for entry in member.availability
        if entry.kind == AvailabilityKind.unavailable
    ]


async def load_inputs(
    db: AsyncSession, window_start: date, window_end: date
) -> tuple[list[FairnessMemberInput], list[FairnessDuty], set[date]]:
    """Members, served duties and Polish holidays for one window."""
    orm_members = (
        (
            await db.scalars(
                select(TeamMember)
                .options(
                    joinedload(TeamMember.eligibility),
                    joinedload(TeamMember.availability),
                )
                .where(
                    TeamMember.active_from <= window_end,
                    (TeamMember.active_until.is_(None)) | (TeamMember.active_until >= window_start),
                )
                .order_by(TeamMember.display_name)
            )
        )
        .unique()
        .all()
    )
    members = [
        FairnessMemberInput(
            id=member.id,
            display_name=member.display_name,
            active_from=member.active_from,
            active_until=member.active_until,
            eligibility={
                role: [
                    EligibilityPeriod(item.starts_on, item.ends_on)
                    for item in member.eligibility
                    if item.role == role
                ]
                for role in AssignmentRole
            },
            unavailable_periods=_unavailable_periods(member),
        )
        for member in orm_members
    ]
    duties = await resolved_duties(db, window_start, window_end)
    return members, duties, polish_holidays(window_start, window_end)


async def resolved_duties(
    db: AsyncSession, window_start: date, window_end: date
) -> list[FairnessDuty]:
    """Duty actually in force in the window, one row per (day, role).

    Once a shorter range is republished inside a longer one both schedules cover
    the overlapping days; reading raw rows counted those duties twice. Everything
    that scores fairness - the report, the swap preview, the draft forecast and
    the generator - has to come through here or the numbers stop agreeing.
    """
    resolved = await effective_assignments(db, window_start, window_end)
    return [
        FairnessDuty(
            service_date=item.service_date,
            role=item.role,
            assignee_name=item.assignee_name,
            member_id=item.member_id,
        )
        for item in sorted_assignments(resolved)
    ]


@dataclass(frozen=True)
class SolverHistory:
    """What the generator has to know about duty already served.

    Same window, same per-slot resolution and same lenses as the fairness report,
    so `#sprawiedliwość` and the generator can never disagree about what somebody
    is owed. Keyed by display name because that is the only handle the solver has
    on a person.
    """

    points: dict[tuple[str, AssignmentRole], float]
    lenses: dict[tuple[str, str], float]


async def solver_history(
    db: AsyncSession,
    window_start: date,
    window_end: date,
    names_by_id: dict[uuid.UUID, str],
) -> SolverHistory:
    """Duty served in the given window, resolved per slot.

    The window is an explicit argument - the same one handed to the solver as
    `history_window` - so the points and the exposure counted from them can
    never drift apart. Resolving matters: once a fortnight is republished inside
    a published month both schedules cover the overlapping days, and counting
    every row made those duties look like two or three. Identity leads and the
    label is only the fallback, so a rename cannot detach somebody from their
    history.
    """
    holidays = polish_holidays(window_start, window_end)
    resolved = await effective_assignments(db, window_start, window_end)
    points: dict[tuple[str, AssignmentRole], float] = defaultdict(float)
    lenses: dict[tuple[str, str], float] = defaultdict(float)
    for item in resolved.values():
        name = names_by_id.get(item.member_id) if item.member_id is not None else None
        name = name or item.assignee_name
        if item.role in ONCALL_ROLES:
            points[(name, item.role)] += day_weight(item.service_date, holidays)
            if item.service_date.weekday() >= 5:
                lenses[(name, "weekends")] += 1.0
            elif item.service_date in holidays:
                lenses[(name, "holidays")] += 1.0
        else:
            points[(name, item.role)] += 1.0
    return SolverHistory(points=dict(points), lenses=dict(lenses))


async def prior_oncall_days(
    db: AsyncSession,
    starts_on: date,
    names_by_id: dict[uuid.UUID, str],
) -> dict[str, set[date]]:
    """Effective on-call days immediately before a generated horizon."""
    resolved = await effective_assignments(
        db, starts_on - timedelta(days=6), starts_on - timedelta(days=1)
    )
    result: dict[str, set[date]] = defaultdict(set)
    for item in resolved.values():
        if item.role not in ONCALL_ROLES:
            continue
        name = names_by_id.get(item.member_id) if item.member_id is not None else None
        result[name or item.assignee_name].add(item.service_date)
    return dict(result)


async def own_member(db: AsyncSession, user: User) -> TeamMember | None:
    return await db.scalar(select(TeamMember).where(TeamMember.user_id == user.id))


def category_response(balance: CategoryBalance) -> FairnessCategoryResponse:
    return FairnessCategoryResponse(
        actual=balance.actual, expected=balance.expected, deviation=balance.deviation
    )


def member_response(
    member: MemberBalance, criterion_ids: set[uuid.UUID] | None = None
) -> FairnessMemberResponse:
    return FairnessMemberResponse(
        member_id=member.member_id,
        display_name=member.display_name,
        active_from=member.active_from,
        eligible_days=member.eligible_days,
        primary=category_response(member.primary),
        secondary=category_response(member.secondary),
        late_shift=category_response(member.late_shift),
        weekends=category_response(member.weekends),
        holidays=category_response(member.holidays),
        total_points=member.total_points,
        in_criterion=criterion_ids is None or member.member_id in criterion_ids,
    )
