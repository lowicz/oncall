"""The monthly report: per-person duty counters and fully staffed days.

The CSV export and the JSON preview both read this one result, so the two can
never show different numbers (QA-REPORT-2, NEW-05).
"""

from datetime import date, timedelta

from oncall.domain.reports.errors import InvalidMonth
from oncall.domain.reports.models import DutyTally, MonthlyReport, MonthlyRow
from oncall.domain.reports.ports import ReportPorts
from oncall.domain.vocabulary import AssignmentRole
from oncall.fairness import day_weight
from oncall.workdays import polish_holidays


def month_range(month: str) -> tuple[date, date]:
    try:
        start = date.fromisoformat(f"{month}-01")
    except ValueError as error:
        raise InvalidMonth(month) from error
    if start.month == 12:
        next_month = date(start.year + 1, 1, 1)
    else:
        next_month = date(start.year, start.month + 1, 1)
    return start, next_month - timedelta(days=1)


async def monthly_report(month: str, ports: ReportPorts) -> MonthlyReport:
    starts_on, ends_on = month_range(month)
    members = await ports.members.members_active_between(starts_on, ends_on)
    # Shared resolution: one duty per slot, newest publication wins, and each
    # carries the member id so a rename cannot drop somebody from the report.
    in_force = await ports.roster.duties_in_force(starts_on, ends_on)
    holidays = polish_holidays(starts_on, ends_on)
    # Counted by display name, so two members sharing a name share one row.
    tallies = {member.display_name: DutyTally() for member in members}
    names = {member.id: member.display_name for member in members}
    for duty in in_force.values():
        # Identity first; the label is the fallback for imported rows.
        name = names.get(duty.member_id) if duty.member_id else None
        if name is None:
            name = duty.assignee_name
        tally = tallies.get(name)
        if tally is None:
            continue
        day = duty.service_date
        if duty.role == AssignmentRole.late_shift:
            if day.weekday() < 5 and day not in holidays:
                tally.late_shift += 1
            continue
        # A statutory holiday that falls on a weekend is a weekend (decision
        # D4), same convention as the scheduler and the fairness report, so a
        # weekend check always wins over a holiday check.
        category = "weekend" if day.weekday() >= 5 else "holiday" if day in holidays else "workday"
        counter = f"{duty.role.value}_{category}"
        setattr(tally, counter, getattr(tally, counter) + 1)
        points = f"{duty.role.value}_points"
        setattr(tally, points, getattr(tally, points) + day_weight(day, holidays))
    staffed_days = sum(
        1
        for offset in range((ends_on - starts_on).days + 1)
        if (starts_on + timedelta(days=offset), AssignmentRole.primary) in in_force
        and (starts_on + timedelta(days=offset), AssignmentRole.secondary) in in_force
    )
    return MonthlyReport(
        month=month,
        starts_on=starts_on,
        ends_on=ends_on,
        staffed_days=staffed_days,
        rows=[MonthlyRow(member.display_name, tallies[member.display_name]) for member in members],
    )
