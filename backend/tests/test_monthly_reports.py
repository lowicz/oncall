import csv
import io
from datetime import UTC, date, datetime

from oncall.domain.vocabulary import AssignmentRole, ScheduleStatus, UserRole
from oncall.infrastructure.sqlalchemy.scheduling_models import Assignment, Schedule
from tests.conftest import create_member, create_user, login


async def test_monthly_csv_splits_workdays_weekends_and_holidays(client, db) -> None:
    anna_user = await create_user(db, "anna-report", display_name="Anna")
    marek_user = await create_user(db, "marek-report", display_name="Marek")
    await create_member(db, anna_user, display_name="Anna")
    await create_member(db, marek_user, display_name="Marek")
    schedule = Schedule(
        name="Sierpień",
        starts_on=date(2026, 8, 15),
        ends_on=date(2026, 8, 17),
        status=ScheduleStatus.published,
        published_at=datetime.now(UTC),
    )
    for day in (date(2026, 8, 15), date(2026, 8, 16), date(2026, 8, 17)):
        schedule.assignments.extend(
            [
                Assignment(service_date=day, role=AssignmentRole.primary, assignee_name="Anna"),
                Assignment(service_date=day, role=AssignmentRole.secondary, assignee_name="Marek"),
            ]
        )
    schedule.assignments.append(
        Assignment(
            service_date=date(2026, 8, 17),
            role=AssignmentRole.late_shift,
            assignee_name="Marek",
        )
    )
    db.add(schedule)
    await db.commit()
    await create_user(db, "coord-report", role=UserRole.coordinator)
    await login(client, "coord-report")

    response = await client.get("/api/v1/reports/monthly.csv", params={"month": "2026-08"})

    assert response.status_code == 200, response.text
    rows = list(csv.DictReader(io.StringIO(response.text.lstrip("\ufeff"))))
    anna = next(row for row in rows if row["osoba"] == "Anna")
    marek = next(row for row in rows if row["osoba"] == "Marek")
    assert anna["primary_dni_robocze"] == "1"
    # 2026-08-15 (Wniebowzięcie NMP) is a Saturday: decision D4 counts a
    # holiday-on-weekend as a weekend everywhere, so it joins 08-16 here
    # instead of showing up in the holiday column (QA7-M13).
    assert anna["primary_weekendy"] == "2"
    assert anna["primary_swieta"] == "0"
    assert anna["primary_punkty"] == "5.0"
    assert marek["zmiany_11_19"] == "1"
    assert response.headers["content-disposition"] == 'attachment; filename="oncall-2026-08.csv"'


async def test_monthly_csv_requires_coordinator(client, db) -> None:
    await create_user(db, "viewer-report", role=UserRole.viewer)
    await login(client, "viewer-report")
    response = await client.get("/api/v1/reports/monthly.csv", params={"month": "2026-08"})
    assert response.status_code == 403
