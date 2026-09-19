"""History import against in-memory ports."""

import uuid
from datetime import date, timedelta

import pytest

from oncall.domain.history.errors import HistoryRejected
from oncall.domain.history.models import HistoryUpload, ParsedHistoryRow
from oncall.domain.history.ports import HistoryPorts
from oncall.domain.history.use_cases import check_history, import_history
from oncall.domain.vocabulary import AssignmentRole, UserRole
from tests.domain.fakes import FakeJournal, actor, member

MONDAY = date(2026, 9, 21)


class FakeArchive:
    def __init__(self, *members, published=()) -> None:
        self.people = list(members)
        self.published = set(published)
        self.staged = None
        self.id = uuid.uuid4()

    async def imports(self):
        return []

    async def members(self):
        return self.people

    async def published_slots(self, starts_on, ends_on):
        return {slot for slot in self.published if starts_on <= slot[0] <= ends_on}

    async def stage(self, history):
        self.staged = history

    async def staged_import_id(self):
        return self.id


def row(number, day, role, name):
    return ParsedHistoryRow(number, day, role, name)


async def test_rows_are_checked_against_membership_eligibility_and_the_calendar() -> None:
    anna = member("Anna", roles=[AssignmentRole.primary, AssignmentRole.late_shift])
    archive = FakeArchive(anna, published={(MONDAY + timedelta(days=1), AssignmentRole.primary)})
    ports = HistoryPorts(archive=archive, journal=FakeJournal())

    problems = await check_history(
        [
            row(2, MONDAY, AssignmentRole.primary, "nieznany"),
            row(3, MONDAY, AssignmentRole.secondary, "ANNA"),
            row(4, MONDAY + timedelta(days=5), AssignmentRole.late_shift, "Anna"),
            row(5, MONDAY + timedelta(days=1), AssignmentRole.primary, "Anna"),
        ],
        ports,
    )

    assert [(item.row_number, item.field) for item in problems] == [
        (2, "assignee_name"),
        (3, "role"),
        (4, "role"),
        (5, "service_date"),
    ]
    assert problems[1].message == "Osoba nie ma eligibility do roli SECONDARY w tym dniu"


async def test_an_import_is_stored_under_roster_names_or_refused_whole() -> None:
    anna = member("Anna")
    archive = FakeArchive(anna)
    journal = FakeJournal()
    ports = HistoryPorts(archive=archive, journal=journal)
    coordinator = actor(UserRole.coordinator)

    with pytest.raises(HistoryRejected) as refused:
        await import_history(
            HistoryUpload(
                coordinator,
                "h.csv",
                [row(0, MONDAY, AssignmentRole.primary, "anna")] * 2,
            ),
            ports,
        )
    assert [item.message for item in refused.value.problems] == ["Duplikat roli dla tego dnia"]
    assert archive.staged is None

    stored = await import_history(
        HistoryUpload(coordinator, "h.csv", [row(0, MONDAY, AssignmentRole.primary, "anna")]),
        ports,
    )
    assert stored == archive.id
    assert archive.staged.name == "Import historii: h.csv"
    assert [(duty.assignee_name, duty.member_id) for duty in archive.staged.duties] == [
        ("Anna", anna.id)
    ]
    assert archive.staged.published_at.date() == MONDAY
    assert journal.names == ["imported"]
