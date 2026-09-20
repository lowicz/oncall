"""QA7: proportionally fair 12-month history, independent of the solver.

Usage: make_history.py OUT.csv
Greedy per assignment unit (a working day, or an indivisible block of days off).
The pick is the eligible person furthest below their exposure-proportional share
on every lens the unit touches, with rest rules mirroring the hybrid-mode hard
constraints (max 3 on-call in 7 days, 2 days rest after a run of >=2).
"""
import csv
import sys
from collections import defaultdict
from datetime import date, timedelta

import os

import holidays as holidays_lib

WB, WK, WL, WR = (float(os.environ.get(k, v)) for k, v in (("WB", "1.5"), ("WK", "1"), ("WL", "0.6"), ("WR", "2")))

START, END = date(2025, 9, 1), date(2026, 8, 30)
P, S, L = "primary", "secondary", "late_shift"
BASE = date(2025, 1, 6)
ROSTER = {
    "Tomasz Krawczyk": (BASE, None, {P, S, L}),
    "Anna Wróbel": (BASE, None, {P, S, L}),
    "Bartosz Kowal": (BASE, None, {P, S, L}),
    "Celina Mazur": (BASE, None, {P, S, L}),
    "Dawid Lewandowski": (BASE, None, {P, S, L}),
    "Elżbieta Kaczmarek": (BASE, None, {P, S, L}),
    "Grzegorz Zieliński": (BASE, None, {P, S}),
    "Halina Szymańska": (BASE, None, {P, S, L}),
    "Igor Wójcik": (BASE, None, {S, L}),
    "Julia Nowak": (date(2026, 3, 2), None, {P, S, L}),
    "Robert Baran": (BASE, date(2026, 3, 1), {P, S, L}),
}
HOL = set(holidays_lib.country_holidays("PL", years=range(2025, 2027)))


def off(d):
    return d.weekday() >= 5 or d in HOL


def active(n, d):
    a, b, _ = ROSTER[n]
    return a <= d and (b is None or d <= b)


days = [START + timedelta(i) for i in range((END - START).days + 1)]
units, i = [], 0
while i < len(days):
    j = i
    if off(days[i]):
        while j + 1 < len(days) and off(days[j + 1]):
            j += 1
    units.append(days[i:j + 1])
    i = j + 1

actual, expo = defaultdict(float), defaultdict(float)
oncall_days = defaultdict(set)
rows = []


def dev(n, lens):
    te = sum(expo[(m, lens)] for m in ROSTER)
    tot = sum(actual[(m, lens)] for m in ROSTER)
    return actual[(n, lens)] - (expo[(n, lens)] / te * tot if te else 0.0)


def rest_penalty(n, unit):
    first = unit[0]
    mine = oncall_days[n]
    pen = 0.0
    if (first - timedelta(1)) in mine:
        pen += WB  # soft: avoid back-to-back
    if (first - timedelta(2)) in mine and (first - timedelta(3)) in mine:
        pen += 1000  # rest after a run (hard in hybrid mode)
    window = sum(1 for k in range(1, 7) if first - timedelta(k) in mine)
    if window + len(unit) > 3:
        pen += 1000  # max 3 on-call in 7 days (hard)
    return pen


for unit in units:
    for d in unit:
        for n, (_, _, roles) in ROSTER.items():
            if not active(n, d):
                continue
            w = 2.0 if off(d) else 1.0
            if P in roles:
                expo[(n, P)] += w
            if S in roles:
                expo[(n, S)] += w
            if L in roles and not off(d):
                expo[(n, L)] += 1
            if d.weekday() >= 5:
                expo[(n, "weekends")] += (P in roles) + (S in roles)
            elif d in HOL:
                expo[(n, "holidays")] += (P in roles) + (S in roles)
    pts = sum(2.0 if off(d) else 1.0 for d in unit)
    wk = sum(1 for d in unit if d.weekday() >= 5)
    hol = sum(1 for d in unit if d.weekday() < 5 and d in HOL)
    taken = set()
    for role in (P, S):
        cands = [n for n in ROSTER if role in ROSTER[n][2] and n not in taken
                 and all(active(n, d) for d in unit)]
        cands.sort(key=lambda n: (
            rest_penalty(n, unit) + WR * dev(n, role)
            + (dev(n, "weekends") * WK if wk else 0) + (dev(n, "holidays") * WK if hol else 0)
            + (WL * dev(n, L) if role == S and not off(unit[0]) and L in ROSTER[n][2] else 0),
            n))
        pick = cands[0]
        taken.add(pick)
        for d in unit:
            rows.append((d, role, pick))
            oncall_days[pick].add(d)
        actual[(pick, role)] += pts
        actual[(pick, "weekends")] += wk
        actual[(pick, "holidays")] += hol
    if not off(unit[0]):
        d = unit[0]
        sec = next(n for (dd, r, n) in reversed(rows) if dd == d and r == S)
        if L in ROSTER[sec][2]:
            pick = sec
        else:
            c = [n for n in ROSTER if L in ROSTER[n][2] and active(n, d) and n not in taken]
            pick = min(c, key=lambda n: (dev(n, L), n))
        rows.append((d, L, pick))
        actual[(pick, L)] += 1

rows.sort(key=lambda r: (r[0], r[1]))
with open(sys.argv[1], "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["service_date", "role", "assignee_name"])
    w.writerows((d.isoformat(), r, n) for d, r, n in rows)
print(f"{len(rows)} rows {START}..{END}")
lenses = (P, S, L, "weekends", "holidays")
print(f"{'osoba':20}" + "".join(f"{x:>11}" for x in lenses))
for n in ROSTER:
    print(f"{n:20}" + "".join(f"{dev(n, x):11.2f}" for x in lenses))
print("spread " + " ".join(
    f"{x}={max(dev(n, x) for n in ROSTER) - min(dev(n, x) for n in ROSTER):.2f}" for x in lenses))
