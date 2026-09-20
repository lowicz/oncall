"""Cross-check the monthly report against an independent count over the same slots."""
import csv
import io
from collections import defaultdict
from datetime import date, timedelta

import holidays as country_holidays

from qa import Client

MONTH = "2026-09"
start = date(2026, 9, 1)
end = date(2026, 9, 30)
holidays = {
    day for day in country_holidays.country_holidays("PL", years=[2026]) if start <= day <= end
}

client = Client("ola.zielinska")
csv_text = client.get(f"/api/v1/reports/monthly.csv?month={MONTH}").text
rows = list(csv.DictReader(io.StringIO(csv_text)))
print("kolumny:", list(rows[0].keys()) if rows else "brak")

calendar = client.get(f"/api/v1/calendar?starts_on={start}&ends_on={end}").json()
expected = defaultdict(lambda: defaultdict(int))
for item in calendar["assignments"]:
    day = date.fromisoformat(item["service_date"])
    name = item["assignee_name"]
    if item["role"] == "late_shift":
        expected[name]["late_shift"] += 1
        continue
    category = "holiday" if day in holidays else "weekend" if day.weekday() >= 5 else "workday"
    expected[name][f"{item['role']}_{category}"] += 1

problems = []
for row in rows:
    name = row.get("osoba") or row.get("display_name") or list(row.values())[0]
    for key, column in (
        ("primary_workday", "primary_dni_robocze"),
        ("primary_weekend", "primary_weekendy"),
        ("primary_holiday", "primary_swieta"),
        ("secondary_workday", "secondary_dni_robocze"),
        ("secondary_weekend", "secondary_weekendy"),
        ("secondary_holiday", "secondary_swieta"),
        ("late_shift", "zmiany_11_19"),
    ):
        if column not in row:
            continue
        if int(row[column]) != expected[name][key]:
            problems.append(f"{name} {column}: raport={row[column]} oczekiwano={expected[name][key]}")
print("\nnaglowek CSV:", csv_text.splitlines()[0])
for line in csv_text.splitlines()[1:4]:
    print(" ", line)
print(f"\nrozbieznosci: {len(problems)}")
for line in problems[:20]:
    print("  ", line)
