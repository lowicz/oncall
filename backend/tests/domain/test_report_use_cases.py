"""The monthly report against in-memory ports."""

import uuid
from datetime import date

import pytest

from oncall.domain.reports.errors import InvalidMonth
from oncall.domain.reports.models import RosterEntry
from oncall.domain.reports.ports import ReportPorts
from oncall.domain.reports.use_cases import month_range, monthly_report
from oncall.domain.vocabulary import AssignmentRole
from tests.domain.fakes import FakeRoster, member


class FakeMembers:
    def __init__(self, *entries: RosterEntry) -> None:
        self.entries = list(entries)

    async def members_active_between(self, starts_on, ends_on):
        return sorted(self.entries, key=lambda item: item.display_name)


def test_a_month_ends_on_its_last_day_including_december_and_february() -> None:
    assert month_range("2026-12") == (date(2026, 12, 1), date(2026, 12, 31))
    assert month_range("2028-02") == (date(2028, 2, 1), date(2028, 2, 29))
    for impossible in ("2026-13", "2026-00", "nope"):
        with pytest.raises(InvalidMonth):
            month_range(impossible)


async def test_duties_are_split_by_day_kind_and_counted_by_identity_first() -> None:
    anna = member("Anna")
    roster = FakeRoster()
    # Friday, Saturday that is also a holiday (15 August), and a plain Monday.
    roster.assign(date(2026, 8, 14), AssignmentRole.primary, anna)
    roster.assign(date(2026, 8, 15), AssignmentRole.primary, anna)
    roster.assign(date(2026, 8, 14), AssignmentRole.late_shift, anna)
    roster.assign(date(2026, 8, 15), AssignmentRole.late_shift, anna)
    # A row without an id counts by its label; a stranger's row is ignored.
    roster.assign(date(2026, 8, 14), AssignmentRole.secondary, "Bartek")
    roster.assign(date(2026, 8, 17), AssignmentRole.secondary, "Zenon z importu")
    members = FakeMembers(RosterEntry(anna.id, "Anna"), RosterEntry(uuid.uuid4(), "Bartek"))

    report = await monthly_report("2026-08", ReportPorts(members=members, roster=roster))

    assert (report.days_in_month, report.staffed_days) == (31, 1)
    anna_row, bartek_row = report.rows
    assert (anna_row.name, bartek_row.name) == ("Anna", "Bartek")
    assert (
        anna_row.tally.primary_workday,
        anna_row.tally.primary_weekend,
        anna_row.tally.primary_holiday,
        anna_row.tally.late_shift,
        anna_row.tally.total_points,
    ) == (1, 1, 0, 1, 3.0)
    assert (bartek_row.tally.secondary_workday, bartek_row.tally.oncall_workdays) == (1, 1)
