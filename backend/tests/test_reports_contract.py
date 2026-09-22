"""Monthly reports, pinned before the counting moved into `oncall.domain.reports`."""

import csv
import io
from datetime import date

from tests.conftest import create_member, create_published_schedule, create_user, login


async def test_monthly_preview_and_csv_agree_and_reject_an_impossible_month(client, db) -> None:
    for username, name in (("anna", "Anna"), ("bartek", "Bartek"), ("ex", "Ex")):
        user = await create_user(db, username, display_name=name)
        member = await create_member(db, user, display_name=name, active_from=date(2026, 1, 1))
        if username == "ex":
            member.active_until = date(2026, 7, 31)
    await db.commit()
    await create_user(db, "koord", role="coordinator")
    # 2026-08-15 is a Saturday and a statutory holiday; 2026-08-14 a Friday.
    await create_published_schedule(
        db,
        starts_on=date(2026, 8, 13),
        days=4,
        primary=["Anna", "Bartek"],
        secondary=["Bartek", "Anna"],
        late_shift=["Anna"],
    )
    await login(client, "koord")

    for month in ("2026-13", "2026-00"):
        response = await client.get("/api/v1/reports/monthly", params={"month": month})
        assert (response.status_code, response.json()["detail"]) == (
            422,
            "Miesiąc musi mieć format RRRR-MM",
        )
        csv_response = await client.get("/api/v1/reports/monthly.csv", params={"month": month})
        assert csv_response.status_code == 422

    preview = await client.get("/api/v1/reports/monthly", params={"month": "2026-08"})
    assert preview.status_code == 200, preview.text
    assert preview.json() == {
        "month": "2026-08",
        "days_in_month": 31,
        "staffed_days": 4,
        "rows": [
            {
                "name": "Anna",
                "primary_workdays": 1,
                "primary_weekends": 1,
                "primary_holidays": 0,
                "secondary_workdays": 1,
                "secondary_weekends": 1,
                "secondary_holidays": 0,
                "oncall_workdays": 2,
                "oncall_weekends": 2,
                "oncall_holidays": 0,
                "late_shifts": 2,
                "primary_points": 3.0,
                "secondary_points": 3.0,
                "total_points": 6.0,
            },
            {
                "name": "Bartek",
                "primary_workdays": 1,
                "primary_weekends": 1,
                "primary_holidays": 0,
                "secondary_workdays": 1,
                "secondary_weekends": 1,
                "secondary_holidays": 0,
                "oncall_workdays": 2,
                "oncall_weekends": 2,
                "oncall_holidays": 0,
                "late_shifts": 0,
                "primary_points": 3.0,
                "secondary_points": 3.0,
                "total_points": 6.0,
            },
        ],
    }

    exported = await client.get("/api/v1/reports/monthly.csv", params={"month": "2026-08"})
    assert exported.headers["content-disposition"] == 'attachment; filename="oncall-2026-08.csv"'
    assert exported.headers["content-type"] == "text/csv; charset=utf-8"
    assert exported.text.splitlines()[1:] == [
        "2026-08,Anna,1,1,0,1,1,0,2,2,0,2,3.0,3.0,6.0",
        "2026-08,Bartek,1,1,0,1,1,0,2,2,0,0,3.0,3.0,6.0",
    ]
    assert exported.content.startswith("﻿".encode())


async def test_csv_export_neutralizes_formula_injection_in_member_names(client, db) -> None:
    """#30: a member name beginning with a formula character must be exported as
    literal text, so opening the CSV in a spreadsheet never evaluates it."""
    dangerous = "=1+337"
    user = await create_user(db, "evil", display_name=dangerous)
    await create_member(db, user, display_name=dangerous, active_from=date(2026, 1, 1))
    await create_user(db, "koord", role="coordinator")
    await login(client, "koord")

    exported = await client.get("/api/v1/reports/monthly.csv", params={"month": "2026-08"})
    assert exported.status_code == 200

    injected = [line for line in exported.text.splitlines() if "1+337" in line]
    assert injected, exported.text
    # Prefixed with an apostrophe so a spreadsheet shows it literally.
    assert injected[0].startswith("2026-08,'=1+337,")

    # It still reads back through a plain CSV parser (the neutralisation is a
    # leading apostrophe, not a mangling of the value).
    rows = list(csv.reader(io.StringIO(exported.text)))
    name_cell = next(row[1] for row in rows if len(row) > 1 and "1+337" in row[1])
    assert name_cell == "'=1+337"
