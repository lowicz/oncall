"""Build a 15-month historical on-call schedule that is fair per fairness lens.

Selection minimises the same deviation the application reports: accrued minus the
share proportional to eligible exposure so far. Weekend and holiday blocks are
indivisible, and working days are chunked so nobody serves more than three
consecutive on-call days.
"""
import csv
import sys
from collections import defaultdict
from datetime import date, timedelta

import holidays as country_holidays

START = date(2025, 6, 1)
END = date(2026, 9, 6)
BASE_FROM = date(2024, 9, 1)
LATE_FROM = date(2026, 4, 1)

PEOPLE = [
    ("Anna Kowalska", BASE_FROM, "PSL"),
    ("Marek Wiśniewski", BASE_FROM, "PSL"),
    ("Ola Zielińska", BASE_FROM, "PSL"),
    ("Piotr Lewandowski", BASE_FROM, "PSL"),
    ("Katarzyna Dąbrowska", BASE_FROM, "PSL"),
    ("Tomasz Szymański", BASE_FROM, "PS"),
    ("Magdalena Woźniak", BASE_FROM, "PSL"),
    ("Rafał Kamiński", BASE_FROM, "SL"),
    ("Julia Nowak", BASE_FROM, "PSL"),
    ("Bartosz Mazur", LATE_FROM, "PSL"),
]

HOLIDAYS = {
    day
    for day in country_holidays.country_holidays("PL", years=range(START.year, END.year + 1))
    if START <= day <= END
}

LENSES = ("primary", "secondary", "late_shift", "weekends", "holidays")

#: How hard the anchored 11-19 lens pulls on the weekday secondary choice.
ANCHOR_PULL = float(__import__("os").environ.get("ANCHOR_PULL", "0.3"))


def days(start: date, end: date) -> list[date]:
    return [start + timedelta(days=offset) for offset in range((end - start).days + 1)]


def is_working(day: date) -> bool:
    return day.weekday() < 5 and day not in HOLIDAYS


def weight(day: date) -> int:
    return 1 if is_working(day) else 2


class Roster:
    def __init__(self) -> None:
        self.names = [name for name, _from, _roles in PEOPLE]
        self.active_from = {name: start for name, start, _roles in PEOPLE}
        self.roles = {name: roles for name, _start, roles in PEOPLE}
        self.accrued: dict[tuple[str, str], float] = defaultdict(float)
        self.exposure: dict[tuple[str, str], float] = defaultdict(float)
        self.total: dict[str, float] = defaultdict(float)
        self.last_duty: dict[str, date] = {}

    def can(self, name: str, letter: str, day: date) -> bool:
        return self.active_from[name] <= day and letter in self.roles[name]

    def oncall(self, name: str, day: date) -> bool:
        return self.can(name, "P", day) or self.can(name, "S", day)

    def add_exposure(self, unit: list[date]) -> None:
        for day in unit:
            for name in self.names:
                if self.can(name, "P", day):
                    self.exposure[(name, "primary")] += weight(day)
                if self.can(name, "S", day):
                    self.exposure[(name, "secondary")] += weight(day)
                if self.can(name, "L", day) and is_working(day):
                    self.exposure[(name, "late_shift")] += 1
                if self.oncall(name, day):
                    if day.weekday() >= 5:
                        self.exposure[(name, "weekends")] += 1
                    elif day in HOLIDAYS:
                        self.exposure[(name, "holidays")] += 1

    def deviation(self, name: str, lens: str) -> float:
        pool = sum(self.exposure[(person, lens)] for person in self.names)
        if pool <= 0:
            return 0.0
        share = self.exposure[(name, lens)] / pool
        return self.accrued[(name, lens)] - share * self.total[lens]

    def pressure(self, name: str, lens: str) -> float:
        """Deviation per eligible day, so a late joiner is not systematically favoured.

        A raw deviation is an absolute number of points; somebody with three months
        of exposure can never be as far from their share as somebody with a year,
        so a raw key would hand every tie to the newest person.
        """
        exposure = self.exposure[(name, lens)]
        return self.deviation(name, lens) / exposure if exposure > 0 else 0.0

    def score(self, name: str, lens: str, unit: list[date]) -> tuple:
        secondary_lenses = []
        # The default policy anchors 11-19 to secondary, so the two lenses move
        # together; the late shift only breaks ties, never outranks the lens itself.
        # The default policy anchors 11-19 to secondary, so on a working stretch the
        # secondary choice is really a late-shift choice for anybody eligible to both.
        anchored = 0.0
        if lens == "secondary" and all(is_working(day) for day in unit):
            anchored = round(
                self.pressure(name, "late_shift" if self.can(name, "L", unit[0]) else "secondary"),
                4,
            )
        if any(day.weekday() >= 5 for day in unit):
            secondary_lenses.append("weekends")
        if any(day.weekday() < 5 and day in HOLIDAYS for day in unit):
            secondary_lenses.append("holidays")
        # The lens the unit is mostly about leads; points break the tie.
        lead = sum(self.pressure(name, item) for item in secondary_lenses)
        last = self.last_duty.get(name, date(2000, 1, 1))
        blend = lead + self.pressure(name, lens) + ANCHOR_PULL * anchored
        return (round(blend, 5), last, name)

    def award(self, name: str, lens: str, unit: list[date], points: float) -> None:
        self.accrued[(name, lens)] += points
        self.total[lens] += points
        if lens in ("primary", "secondary"):
            for day in unit:
                if day.weekday() >= 5:
                    self.accrued[(name, "weekends")] += 1
                    self.total["weekends"] += 1
                elif day in HOLIDAYS:
                    self.accrued[(name, "holidays")] += 1
                    self.total["holidays"] += 1
        self.last_duty[name] = max(unit)


def build_units(all_days: list[date]) -> list[list[date]]:
    """Indivisible day-off blocks, and working stretches cut into runs of at most three."""
    units: list[list[date]] = []
    run: list[date] = []
    working: list[date] = []

    def flush_working() -> None:
        while working:
            take = 3 if len(working) != 4 else 2
            units.append(working[:take])
            del working[:take]

    for day in all_days:
        if is_working(day):
            if run:
                units.append(run)
                run = []
            working.append(day)
        else:
            flush_working()
            run.append(day)
    if run:
        units.append(run)
    flush_working()
    return units


def main() -> None:
    roster = Roster()
    rows: list[tuple[str, str, str]] = []
    for unit in build_units(days(START, END)):
        roster.add_exposure(unit)
        points = sum(weight(day) for day in unit)

        candidates = [name for name in roster.names if all(roster.can(name, "P", day) for day in unit)]
        primary = min(candidates, key=lambda name: roster.score(name, "primary", unit))
        roster.award(primary, "primary", unit, points)

        candidates = [
            name
            for name in roster.names
            if name != primary and all(roster.can(name, "S", day) for day in unit)
        ]
        secondary = min(candidates, key=lambda name: roster.score(name, "secondary", unit))
        roster.award(secondary, "secondary", unit, points)

        for day in unit:
            rows.append((day.isoformat(), "primary", primary))
            rows.append((day.isoformat(), "secondary", secondary))
            if not is_working(day):
                continue
            if roster.can(secondary, "L", day):
                late = secondary
            else:
                pool = [name for name in roster.names if roster.can(name, "L", day)]
                late = min(pool, key=lambda name: (round(roster.pressure(name, "late_shift"), 4), name))
            roster.accrued[(late, "late_shift")] += 1
            roster.total["late_shift"] += 1
            rows.append((day.isoformat(), "late_shift", late))

    rows.sort(key=lambda row: (row[0], row[1]))
    with open(sys.argv[1], "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["service_date", "role", "assignee_name"])
        writer.writerows(rows)

    print(f"rows={len(rows)} range={rows[0][0]}..{rows[-1][0]}")
    print(f"{'osoba':22} " + " ".join(f"{lens:>11}" for lens in LENSES))
    for name in roster.names:
        cells = " ".join(
            f"{roster.accrued[(name, lens)]:6.1f}/{roster.deviation(name, lens):+5.1f}"
            for lens in LENSES
        )
        print(f"{name:22} {cells}")


main()
