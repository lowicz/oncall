"""Check a schedule against every hard rule PLAN.md paragraph 3 states."""
import sys
from collections import defaultdict
from datetime import date, timedelta

import holidays as country_holidays

from qa import Client

MAX_CONSECUTIVE = 3


def working(day, holidays):
    return day.weekday() < 5 and day not in holidays


def check(schedule: dict, mode: str) -> list[str]:
    starts_on = date.fromisoformat(schedule["starts_on"])
    ends_on = date.fromisoformat(schedule["ends_on"])
    days = [starts_on + timedelta(days=n) for n in range((ends_on - starts_on).days + 1)]
    holidays = {
        day
        for day in country_holidays.country_holidays(
            "PL", years=range(starts_on.year, ends_on.year + 1)
        )
    }
    slots: dict[tuple, str] = {}
    for item in schedule["assignments"]:
        slots[(date.fromisoformat(item["service_date"]), item["role"])] = item["assignee_name"]

    problems = []
    for day in days:
        for role in ("primary", "secondary"):
            if (day, role) not in slots:
                problems.append(f"B1 brak obsady {role} {day}")
        if slots.get((day, "primary")) and slots.get((day, "primary")) == slots.get(
            (day, "secondary")
        ):
            problems.append(f"B1 ta sama osoba primary i secondary {day}")
        has_late = (day, "late_shift") in slots
        if working(day, holidays) and not has_late:
            problems.append(f"B2 brak zmiany 11-19 w dzień roboczy {day}")
        if not working(day, holidays) and has_late:
            problems.append(f"B2 zmiana 11-19 w dzień wolny {day}")

    oncall = defaultdict(set)
    for (day, role), name in slots.items():
        if role in ("primary", "secondary"):
            oncall[name].add(day)

    if mode != "weekly":
        for name, served in oncall.items():
            ordered = sorted(served)
            run = 1
            for previous, current in zip(ordered, ordered[1:]):
                run = run + 1 if current - previous == timedelta(days=1) else 1
                if run > MAX_CONSECUTIVE:
                    block = [current - timedelta(days=n) for n in range(run)]
                    # A day-off block longer than the limit is one indivisible decision.
                    if not all(not working(day, holidays) for day in block):
                        problems.append(f"B5 {name}: {run} kolejnych dyżurów do {current}")
                        break
            for start in days:
                window = {start + timedelta(days=n) for n in range(7)}
                count = len(served & window)
                if count > 3 and not any(
                    len([d for d in window & served if not working(d, holidays)]) >= count - 2
                    for _ in (0,)
                ):
                    problems.append(f"B5 {name}: {count} dyżurów w oknie od {start}")
                    break

    # Day-off blocks must be held by one person per role.
    block: list[date] = []
    blocks = []
    for day in days:
        if working(day, holidays):
            if len(block) >= 2:
                blocks.append(block)
            block = []
        else:
            block.append(day)
    if len(block) >= 2:
        blocks.append(block)
    for item in blocks:
        for role in ("primary", "secondary"):
            holders = {slots.get((day, role)) for day in item}
            if len(holders) > 1:
                problems.append(f"B7 blok {item[0]}..{item[-1]} rola {role} podzielony: {holders}")
    return problems


if __name__ == "__main__":
    client = Client("ola.zielinska")
    schedule = client.get(f"/api/v1/scheduling/{sys.argv[1]}").json()
    mode = schedule.get("rotation_mode") or "hybrid"
    print(f"{schedule['name']} status={schedule['status']} solver={schedule.get('solver_status')}")
    found = check(schedule, mode)
    print(f"naruszenia: {len(found)}")
    for line in found[:40]:
        print(" -", line)
