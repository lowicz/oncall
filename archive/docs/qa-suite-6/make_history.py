"""QA6: deterministic, proportionally-fair 12-month history.

Not built with the solver on purpose: the baseline has to be an independent
yardstick, otherwise the solver would be measured against its own output.
Each lens (primary points, secondary points, weekend duties, weekday-holiday
duties, 11-19 count) is balanced against the member's own exposure, so the
person who joined in April gets a proportionally smaller share instead of a
year of debt.
"""
import csv
import sys
from collections import defaultdict
from datetime import date, timedelta

import holidays as holidays_lib

import os

TILT = float(os.environ.get("QA6_TILT", "0"))

START = date(2025, 9, 1)
END = date(2026, 9, 6)

P, S, L = "primary", "secondary", "late_shift"

# name -> (active_from, eligible roles)
ROSTER = {
    "Adam Nowicki":   (date(2024, 1, 8), {P, S, L}),
    "Beata Lis":      (date(2024, 1, 8), {P, S, L}),
    "Cezary Dudek":   (date(2024, 1, 8), {P, S, L}),
    "Dorota Pawlak":  (date(2024, 1, 8), {P, S, L}),
    "Emil Zając":     (date(2024, 1, 8), {P, S}),
    "Filip Górski":   (date(2024, 1, 8), {P, S, L}),
    "Grażyna Wilk":   (date(2024, 1, 8), {P, S, L}),
    "Hubert Baran":   (date(2024, 1, 8), {P, S, L}),
    "Iwona Sadowska": (date(2024, 1, 8), {P, S, L}),
    "Jakub Polak":    (date(2026, 4, 1), {P, S, L}),
}

pl = holidays_lib.country_holidays("PL", years=range(START.year, END.year + 1))
HOL = {d for d in pl}


def days(a, b):
    return [a + timedelta(days=i) for i in range((b - a).days + 1)]


def is_day_off(d):
    return d.weekday() >= 5 or d in HOL


def weight(d):
    return 2.0 if is_day_off(d) else 1.0


ALL = days(START, END)

# Units of assignment: a run of consecutive days off is indivisible, exactly as
# the solver treats it; every working day stands alone.
units = []
i = 0
while i < len(ALL):
    if is_day_off(ALL[i]):
        j = i
        while j + 1 < len(ALL) and is_day_off(ALL[j + 1]):
            j += 1
        units.append(ALL[i : j + 1])
        i = j + 1
    else:
        units.append([ALL[i]])
        i += 1


def active(name, d):
    return ROSTER[name][0] <= d


def eligible(name, role, unit):
    return role in ROSTER[name][1] and all(active(name, d) for d in unit)


# Running totals per lens, plus the exposure each person has accumulated so far.
actual = defaultdict(float)      # (name, lens) -> value
exposure = defaultdict(float)    # (name, lens) -> weighted days the person could have served
LENSES = ("primary", "secondary", "late_shift", "weekends", "holidays")

rows = []

for unit in units:
    # Exposure grows for everybody who was in the rotation on these days,
    # whether or not they ended up serving.
    for d in unit:
        for name, (start, roles) in ROSTER.items():
            if not active(name, d):
                continue
            w = weight(d)
            if P in roles:
                exposure[(name, "primary")] += w
            if S in roles:
                exposure[(name, "secondary")] += w
            if L in roles and not is_day_off(d):
                exposure[(name, "late_shift")] += 1.0
            if P in roles or S in roles:
                if d.weekday() >= 5:
                    exposure[(name, "weekends")] += 1.0
                elif d in HOL:
                    exposure[(name, "holidays")] += 1.0

    def totals(lens):
        return sum(actual[(n, lens)] for n in ROSTER)

    def total_exposure(lens):
        return sum(exposure[(n, lens)] for n in ROSTER)

    def deviation(name, lens):
        """How far ahead of a proportional share this person already is."""
        te = total_exposure(lens)
        share = exposure[(name, lens)] / te if te else 0.0
        return actual[(name, lens)] - share * totals(lens)

    unit_points = sum(weight(d) for d in unit)
    weekend_days = sum(1 for d in unit if d.weekday() >= 5)
    holiday_days = sum(1 for d in unit if d.weekday() < 5 and d in HOL)

    taken = set()
    for role, lens in ((P, "primary"), (S, "secondary")):
        cands = [n for n in ROSTER if eligible(n, role, unit) and n not in taken]
        # The person furthest below their proportional share on every lens this
        # unit touches goes first; ties break on the name so the run repeats.
        cands.sort(
            key=lambda n: (
                deviation(n, lens)
                + (deviation(n, "weekends") if weekend_days else 0.0)
                + (deviation(n, "holidays") if holiday_days else 0.0)
                # Total on-call load as a secondary pull, so nobody drifts up on
                # both role lenses at once just because ties kept falling their way.
                + TILT * (deviation(n, "primary") + deviation(n, "secondary")),
                n,
            )
        )
        pick = cands[0]
        taken.add(pick)
        for d in unit:
            rows.append((d, role, pick))
        actual[(pick, lens)] += unit_points
        actual[(pick, "weekends")] += weekend_days
        actual[(pick, "holidays")] += holiday_days

    # 11-19 follows secondary, matching the default `secondary` anchor; when the
    # secondary cannot hold it, the least-served eligible person does.
    for d in unit:
        if is_day_off(d):
            continue
        second = next(n for (dd, r, n) in reversed(rows) if dd == d and r == S)
        if L in ROSTER[second][1]:
            pick = second
        else:
            cands = [n for n in ROSTER if eligible(n, L, [d])]
            cands.sort(key=lambda n: (deviation(n, "late_shift"), n))
            pick = cands[0]
        rows.append((d, L, pick))
        actual[(pick, "late_shift")] += 1.0


def report_spreads(rows, w_start, w_end):
    """Same lens maths as oncall.fairness, for offline tuning of the baseline."""
    act = defaultdict(float)
    expo = defaultdict(float)
    for d in days(w_start, w_end):
        for name, (start, roles) in ROSTER.items():
            if not active(name, d):
                continue
            w = weight(d)
            if P in roles:
                expo[(name, "primary")] += w
            if S in roles:
                expo[(name, "secondary")] += w
            if L in roles and not is_day_off(d):
                expo[(name, "late_shift")] += 1.0
            if P in roles or S in roles:
                if d.weekday() >= 5:
                    expo[(name, "weekends")] += 1.0
                elif d in HOL:
                    expo[(name, "holidays")] += 1.0
    for d, role, name in rows:
        if not (w_start <= d <= w_end):
            continue
        if role == L:
            act[(name, "late_shift")] += 1.0
        else:
            act[(name, role)] += weight(d)
            if d.weekday() >= 5:
                act[(name, "weekends")] += 1.0
            elif d in HOL:
                act[(name, "holidays")] += 1.0
    out = {}
    for lens in LENSES:
        tot = sum(act[(n, lens)] for n in ROSTER)
        te = sum(expo[(n, lens)] for n in ROSTER)
        devs = []
        for n in ROSTER:
            share = expo[(n, lens)] / te if te else 0.0
            devs.append(round(act[(n, lens)] - share * tot, 2))
        out[lens] = round(max(devs) - min(devs), 2)
    return out


if os.environ.get("QA6_SCORE"):
    sp = report_spreads(rows, date(2025, 9, 7), date(2026, 9, 7))
    print(f"TILT={TILT} " + " ".join(f"{k}={v}" for k, v in sp.items()) + f" MAX={max(sp.values())}")
    raise SystemExit(0)

rows.sort(key=lambda r: (r[0], r[1]))
out = sys.argv[1]
with open(out, "w", newline="", encoding="utf-8") as fh:
    w = csv.writer(fh)
    w.writerow(["service_date", "role", "assignee_name"])
    for d, role, name in rows:
        w.writerow([d.isoformat(), role, name])

print(f"{len(rows)} wierszy, {START} - {END} -> {out}")
print(f"{'osoba':16} {'primary':>8} {'secondary':>10} {'11-19':>7} {'weekend':>8} {'swieta':>7}")
for n in sorted(ROSTER):
    print(f"{n:16} {actual[(n,'primary')]:8.1f} {actual[(n,'secondary')]:10.1f} "
          f"{actual[(n,'late_shift')]:7.0f} {actual[(n,'weekends')]:8.0f} {actual[(n,'holidays')]:7.0f}")
