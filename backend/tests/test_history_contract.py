"""History import answers, pinned before validation moved into
`oncall.domain.history`: every validation message in order, the preview
body, the size limit, the stored import and its audit entry."""

from datetime import date, timedelta

from sqlalchemy import delete, select

from oncall.domain.vocabulary import AssignmentRole, ScheduleStatus, UserRole
from oncall.infrastructure.sqlalchemy.audit_model import AuditEvent
from oncall.infrastructure.sqlalchemy.scheduling_models import Schedule
from oncall.infrastructure.sqlalchemy.team_models import Eligibility
from tests.conftest import create_member, create_published_schedule, create_user, login

# 2026-09-21 is a Monday; 2026-09-26 a Saturday.
MONDAY = date(2026, 9, 21)


def _csv(rows) -> bytes:
    return (
        "service_date,role,assignee_name\n"
        + "".join(f"{day.isoformat()},{role},{name}\n" for day, role, name in rows)
    ).encode()


async def test_history_import_contract(client, db) -> None:
    await create_user(db, "koord", role=UserRole.coordinator, display_name="Koordynator")
    anna_user = await create_user(db, "anna", display_name="Anna")
    anna = await create_member(db, anna_user, display_name="Anna", active_from=MONDAY)
    anna.active_until = MONDAY + timedelta(days=30)
    bartek_user = await create_user(db, "bartek", display_name="Bartek")
    bartek = await create_member(
        db, bartek_user, display_name="Bartek", active_from=MONDAY - timedelta(days=100)
    )
    await db.execute(
        delete(Eligibility).where(
            Eligibility.member_id == bartek.id, Eligibility.role == AssignmentRole.secondary
        )
    )
    await db.commit()
    await create_published_schedule(
        db, starts_on=MONDAY + timedelta(days=2), days=1, primary=["Anna"]
    )
    await login(client, "koord")

    too_big = await client.post(
        "/api/v1/history/preview",
        files={"file": ("h.csv", b"x" * (1024 * 1024 + 1), "text/csv")},
    )
    assert (too_big.status_code, too_big.json()["detail"]) == (413, "Plik przekracza 1 MB")

    rows = [
        (MONDAY, "primary", "Nieznany"),
        (MONDAY - timedelta(days=1), "primary", "anna"),
        (MONDAY, "secondary", "Bartek"),
        (MONDAY + timedelta(days=2), "primary", "Anna"),
        (MONDAY + timedelta(days=1), "primary", "Anna"),
        (MONDAY + timedelta(days=1), "secondary", "ANNA"),
    ]
    preview = await client.post(
        "/api/v1/history/preview", files={"file": ("historia.csv", _csv(rows), "text/csv")}
    )
    assert preview.status_code == 200, preview.text
    body = preview.json()
    expected_errors = [
        {"row_number": 2, "field": "assignee_name", "message": "Osoby nie ma w zespole"},
        {
            "row_number": 3,
            "field": "service_date",
            "message": "Data dyżuru jest poza okresem członkostwa tej osoby w rotacji",
        },
        {
            "row_number": 4,
            "field": "role",
            "message": "Osoba nie ma eligibility do roli SECONDARY w tym dniu",
        },
        {
            "row_number": 5,
            "field": "service_date",
            "message": "Data dyżuru jest objęta grafikiem opublikowanym",
        },
        {
            "row_number": 7,
            "field": "assignee_name",
            "message": "Ta sama osoba nie może być primary i secondary jednego dnia",
        },
    ]
    assert (body["filename"], body["valid"], body["errors"]) == (
        "historia.csv",
        False,
        expected_errors,
    )
    assert body["rows"][0] == {
        "row_number": 2,
        "service_date": MONDAY.isoformat(),
        "role": "primary",
        "assignee_name": "Nieznany",
    }

    rejected = await client.post(
        "/api/v1/history/commit",
        json={
            "filename": "historia.csv",
            "rows": [
                {"service_date": day.isoformat(), "role": role, "assignee_name": name}
                for day, role, name in rows
            ]
            + [
                {"service_date": MONDAY.isoformat(), "role": "primary", "assignee_name": "Anna"},
                {
                    "service_date": (MONDAY + timedelta(days=5)).isoformat(),
                    "role": "late_shift",
                    "assignee_name": "Anna",
                },
            ],
        },
    )
    assert rejected.status_code == 422
    # Member checks come first, then the 11-19 rule, the published slots and
    # the one-person-both-roles rule, each over every row.
    assert rejected.json()["detail"] == [
        *expected_errors[:3],
        {
            "row_number": 9,
            "field": "role",
            "message": "Zmiana 11–19 jest dozwolona tylko w dni robocze",
        },
        *expected_errors[3:],
        {"row_number": None, "field": "role", "message": "Duplikat roli dla tego dnia"},
    ]
    assert await db.scalar(select(Schedule).where(Schedule.name.startswith("Import"))) is None

    committed = await client.post(
        "/api/v1/history/commit",
        json={
            "filename": "ok.csv",
            "rows": [
                {"service_date": MONDAY.isoformat(), "role": "primary", "assignee_name": "anna"},
                {
                    "service_date": (MONDAY + timedelta(days=1)).isoformat(),
                    "role": "late_shift",
                    "assignee_name": "Anna",
                },
            ],
        },
    )
    assert committed.status_code == 201, committed.text
    stored = await db.scalar(select(Schedule).where(Schedule.name == "Import historii: ok.csv"))
    assert committed.json() == {"schedule_id": str(stored.id), "imported_rows": 2}
    assert (stored.status, stored.starts_on, stored.ends_on) == (
        ScheduleStatus.superseded,
        MONDAY,
        MONDAY + timedelta(days=1),
    )
    event = await db.scalar(select(AuditEvent).where(AuditEvent.action == "history.imported"))
    # Pre-existing: the audit entry is written before the schedule has an id.
    assert (event.entity_id, event.summary, event.details) == (
        None,
        f"Zaimportowano historię z „ok.csv”: 2 wierszy ({MONDAY} – {MONDAY + timedelta(days=1)})",
        {"rows": 2},
    )
    imports = (await client.get("/api/v1/history/imports")).json()
    assert [(item["name"], item["rows"]) for item in imports] == [("ok.csv", 2)]
