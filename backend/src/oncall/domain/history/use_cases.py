"""Past duties imported from a file.

An import is checked against the rotation as it is recorded here: the person
must be a member on that day and eligible for the role, the 11-19 shift exists
only on working days, a published schedule is never overwritten, and nobody
holds both on-call roles on one day. It is stored as retired history, so any
real publication of the same slot wins over it. Nothing here commits.
"""

import uuid
from datetime import UTC, date, datetime, time

from oncall.domain.history.errors import HistoryRejected
from oncall.domain.history.models import (
    IMPORT_NAME_PREFIX,
    HistoryImport,
    HistoryImportError,
    HistoryUpload,
    ImportedDuty,
    NewHistoryImport,
    ParsedHistoryRow,
)
from oncall.domain.history.ports import HistoryPorts
from oncall.domain.roster import Slot
from oncall.domain.team import Member
from oncall.domain.vocabulary import ROLE_LABELS, AssignmentRole
from oncall.workdays import is_working_day, polish_holidays


async def list_history_imports(ports: HistoryPorts) -> list[HistoryImport]:
    return await ports.archive.imports()


async def check_history(
    rows: list[ParsedHistoryRow], ports: HistoryPorts
) -> list[HistoryImportError]:
    """Every reason this file would be refused, in the order a reader gets them.

    Four rules, each asked of every row before the next rule starts. Applying
    them rule by rule rather than row by row is what the import screen shows:
    all the unknown names together, then all the wrong days, rather than one
    row's three complaints interleaved with the next row's.
    """
    members = await ports.archive.members()
    problems = _people_may_hold_these_duties(rows, members)
    if not rows:
        # The remaining rules are all asked over the file's date range, and an
        # empty file has none.
        return problems
    starts_on = min(row.service_date for row in rows)
    ends_on = max(row.service_date for row in rows)
    problems += _late_shifts_fall_on_working_days(rows, starts_on, ends_on)
    problems += _days_are_free_of_publications(
        rows, await ports.archive.published_slots(starts_on, ends_on)
    )
    problems += _nobody_holds_both_oncall_roles(rows)
    return problems


def _people_may_hold_these_duties(
    rows: list[ParsedHistoryRow], members: list[Member]
) -> list[HistoryImportError]:
    """The person is in the rotation, was in it that day, and held that role.

    One complaint per row, the first that applies: somebody who is not on the
    roster at all cannot be asked the other two questions.
    """
    names = {member.display_name.casefold(): member for member in members}
    problems = []
    for row in rows:
        member = names.get(row.assignee_name.casefold())
        if member is None:
            problems.append(
                HistoryImportError(row.row_number, "assignee_name", "Osoby nie ma w zespole")
            )
        elif not (
            member.active_from <= row.service_date
            and (member.active_until is None or row.service_date <= member.active_until)
        ):
            problems.append(
                HistoryImportError(
                    row.row_number,
                    "service_date",
                    "Data dyżuru jest poza okresem członkostwa tej osoby w rotacji",
                )
            )
        elif not any(
            item.role == row.role
            and item.starts_on <= row.service_date
            and (item.ends_on is None or row.service_date <= item.ends_on)
            for item in member.eligibility
        ):
            # Eligibility is checked as well as the membership period: a
            # `primary` row for somebody who never held the role would import
            # cleanly and then count against their fair share.
            problems.append(
                HistoryImportError(
                    row.row_number,
                    "role",
                    f"Osoba nie ma eligibility do roli {ROLE_LABELS[row.role]} w tym dniu",
                )
            )
    return problems


def _late_shifts_fall_on_working_days(
    rows: list[ParsedHistoryRow], starts_on: date, ends_on: date
) -> list[HistoryImportError]:
    """The 11-19 shift exists only on Polish working days."""
    holidays = polish_holidays(starts_on, ends_on)
    return [
        HistoryImportError(
            row.row_number, "role", "Zmiana 11–19 jest dozwolona tylko w dni robocze"
        )
        for row in rows
        if row.role == AssignmentRole.late_shift and not is_working_day(row.service_date, holidays)
    ]


def _days_are_free_of_publications(
    rows: list[ParsedHistoryRow], published: set[Slot]
) -> list[HistoryImportError]:
    """History never overwrites a slot a real publication already holds."""
    return [
        HistoryImportError(
            row.row_number, "service_date", "Data dyżuru jest objęta grafikiem opublikowanym"
        )
        for row in rows
        if (row.service_date, row.role) in published
    ]


def _nobody_holds_both_oncall_roles(rows: list[ParsedHistoryRow]) -> list[HistoryImportError]:
    """One person cannot be primary and secondary on the same day.

    The row that is flagged is the later of the pair: the first one is not
    wrong until something contradicts it.
    """
    problems = []
    oncall_by_day: dict[date, dict[str, ParsedHistoryRow]] = {}
    for row in rows:
        if row.role not in (AssignmentRole.primary, AssignmentRole.secondary):
            continue
        day = oncall_by_day.setdefault(row.service_date, {})
        previous = day.get(row.assignee_name.casefold())
        if previous is not None and previous.role != row.role:
            problems.append(
                HistoryImportError(
                    row.row_number,
                    "assignee_name",
                    "Ta sama osoba nie może być primary i secondary jednego dnia",
                )
            )
        day[row.assignee_name.casefold()] = row
    return problems


async def import_history(upload: HistoryUpload, ports: HistoryPorts) -> uuid.UUID:
    rows = [
        ParsedHistoryRow(index + 2, row.service_date, row.role, row.assignee_name)
        for index, row in enumerate(upload.rows)
    ]
    problems = await check_history(rows, ports)
    slots = [(row.service_date, row.role) for row in rows]
    if len(slots) != len(set(slots)):
        problems.append(HistoryImportError(None, "role", "Duplikat roli dla tego dnia"))
    if problems:
        raise HistoryRejected(problems)

    members = {member.display_name.casefold(): member for member in await ports.archive.members()}
    starts_on = min(row.service_date for row in rows)
    ends_on = max(row.service_date for row in rows)
    duties = []
    for row in rows:
        member = members.get(row.assignee_name.casefold())
        duties.append(
            ImportedDuty(
                service_date=row.service_date,
                role=row.role,
                # Validation already matched the person case-insensitively, so
                # always store the roster name, never the raw CSV string: a
                # differently-cased input would otherwise land with a null
                # member id and a name no report could match.
                assignee_name=member.display_name if member is not None else row.assignee_name,
                member_id=member.id if member is not None else None,
            )
        )
    history = NewHistoryImport(
        name=f"{IMPORT_NAME_PREFIX}{upload.filename}",
        starts_on=starts_on,
        ends_on=ends_on,
        # Not "now": duty resolution orders imports before every real
        # publication anyway, but a wall-clock timestamp would make a
        # historical file look like the newest schedule in the system.
        # Placing the import at the start of its own range keeps ordering
        # deterministic.
        published_at=datetime.combine(starts_on, time.min, tzinfo=UTC),
        duties=duties,
    )
    await ports.archive.stage(history)
    await ports.journal.imported(history, filename=upload.filename, rows=len(rows))
    return await ports.archive.staged_import_id()
