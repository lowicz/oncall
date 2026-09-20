"""QA7: independent hard-rule checker for one schedule, read straight from Postgres.

Usage: check_rules.py SCHEDULE_ID [--mode hybrid|daily|weekly]
Checks the schedule's own days, with rest rules evaluated across the boundary
against the effective history (imports + published) before it.
"""
import csv
import io
import subprocess
import sys
from collections import defaultdict
from datetime import date, timedelta

import holidays as holidays_lib

SID = sys.argv[1]
MODE = sys.argv[sys.argv.index("--mode") + 1] if "--mode" in sys.argv else None


def q(sql):
    out = subprocess.run(
        ["docker", "compose", "exec", "-T", "db", "psql", "-U", "oncall", "-d", "oncall",
         "--csv", "-c", sql], capture_output=True, text=True, check=True).stdout
    return list(csv.DictReader(io.StringIO(out)))


sched = q(f"select * from schedules where id='{SID}'")[0]
MODE = MODE or sched["rotation_mode"]
start, end = date.fromisoformat(sched["starts_on"]), date.fromisoformat(sched["ends_on"])
HOL = set(holidays_lib.country_holidays("PL", years=range(start.year - 1, end.year + 2)))
off = lambda d: d.weekday() >= 5 or d in HOL
days = [start + timedelta(i) for i in range((end - start).days + 1)]
extended_days = [
    start - timedelta(14) + timedelta(i)
    for i in range((end - start).days + 15)
]
exempt = set()
running = []
for day in extended_days + [None]:
    if day is not None and off(day):
        running.append(day)
        continue
    if len(running) > 3:
        exempt.update(running)
    running = []

members = {m["id"]: m for m in q("select * from team_members")}
by_name = {m["display_name"]: m for m in members.values()}
elig = defaultdict(list)
for e in q("select * from eligibility"):
    elig[e["member_id"]].append(e)
unavail = defaultdict(list)
for a in q("select * from availability where kind='unavailable'"):
    unavail[a["member_id"]].append((date.fromisoformat(a["starts_on"]), date.fromisoformat(a["ends_on"])))
policy = (q("select late_shift_anchor from scheduling_policies") or [{"late_shift_anchor": "secondary"}])[0]

rows = q(f"select service_date, role, assignee_name, member_id from assignments where schedule_id='{SID}'")
slot = {(date.fromisoformat(r["service_date"]), r["role"]): r for r in rows}

# Effective on-call days before the horizon, newest publication wins per slot.
prior = q(
    "select distinct on (a.service_date, a.role) a.service_date, a.role, a.assignee_name "
    "from assignments a join schedules s on s.id=a.schedule_id "
    f"where s.status in ('published','superseded') and a.service_date >= '{start - timedelta(14)}' "
    f"and a.service_date < '{start}' and a.role in ('primary','secondary') "
    "order by a.service_date, a.role, s.published_at desc nulls last")
oncall = defaultdict(set)
for r in prior:
    oncall[r["assignee_name"]].add(date.fromisoformat(r["service_date"]))

errors = []
E = errors.append
for d in days:
    for role in ("primary", "secondary"):
        if (d, role) not in slot:
            E(f"{d} {role}: brak obsady")
    if off(d) and (d, "late_shift") in slot:
        E(f"{d} late_shift w dzień wolny")
    if not off(d) and (d, "late_shift") not in slot:
        E(f"{d} late_shift: brak obsady")
    p, s = slot.get((d, "primary")), slot.get((d, "secondary"))
    if p and s and p["assignee_name"] == s["assignee_name"]:
        E(f"{d} primary == secondary ({p['assignee_name']})")
for (d, role), r in slot.items():
    m = by_name.get(r["assignee_name"])
    if not m:
        E(f"{d} {role}: {r['assignee_name']} spoza zespołu")
        continue
    if not (date.fromisoformat(m["active_from"]) <= d and (not m["active_until"] or d <= date.fromisoformat(m["active_until"]))):
        E(f"{d} {role}: {m['display_name']} poza okresem członkostwa")
    if not any(e["role"] == role and date.fromisoformat(e["starts_on"]) <= d and (not e["ends_on"] or d <= date.fromisoformat(e["ends_on"])) for e in elig[m["id"]]):
        E(f"{d} {role}: {m['display_name']} bez eligibility")
    if any(a <= d <= b for a, b in unavail[m["id"]]):
        E(f"{d} {role}: {m['display_name']} zgłosił niedostępność")
    if role in ("primary", "secondary"):
        oncall[r["assignee_name"]].add(d)
anchor = policy["late_shift_anchor"]
if anchor != "independent":
    for d in days:
        ls, an = slot.get((d, "late_shift")), slot.get((d, anchor))
        if ls and an and ls["assignee_name"] != an["assignee_name"]:
            m = by_name[an["assignee_name"]]
            has_l = any(e["role"] == "late_shift" for e in elig[m["id"]])
            if has_l:
                E(f"{d} 11-19 ({ls['assignee_name']}) != {anchor} ({an['assignee_name']}) mimo eligibility")
# Indivisible day-off blocks.
i = 0
while i < len(days):
    if off(days[i]):
        j = i
        while j + 1 < len(days) and off(days[j + 1]):
            j += 1
        for role in ("primary", "secondary"):
            names = {slot[(d, role)]["assignee_name"] for d in days[i:j + 1] if (d, role) in slot}
            if len(names) > 1:
                E(f"blok {days[i]}..{days[j]} {role} podzielony: {sorted(names)}")
        i = j + 1
    else:
        i += 1
if start.weekday() in (6,) or (off(start) and off(start - timedelta(1))):
    E(f"zakres zaczyna się w środku bloku dni wolnych ({start})")
if MODE in ("hybrid", "daily"):
    for n, ds in oncall.items():
        for d in days:
            if all(d - timedelta(k) in ds and d - timedelta(k) not in exempt for k in range(4)):
                E(f"{d} {n}: >3 kolejne noce")
            w = sum(1 for k in range(7) if d - timedelta(k) in ds and d - timedelta(k) not in exempt)
            if w > 3:
                E(f"{d} {n}: {w} dyżury w 7 dniach")
            # run of >=2 ending at d-1 must be followed by 2 free days
            if d in ds and d not in exempt and (d - timedelta(1)) not in ds:
                for gap in (1,):
                    prev = d - timedelta(gap + 1)
                    involved = (prev - timedelta(1), prev, d)
                    if prev in ds and (prev - timedelta(1)) in ds and not any(day in exempt for day in involved) and all((d - timedelta(k)) not in ds for k in range(1, gap + 1)):
                        E(f"{d} {n}: tylko {gap} dzień przerwy po serii")

print(f"{sched['name']} [{sched['status']}] {MODE} {start}..{end} slots={len(slot)}")
print(f"BŁĘDY: {len(errors)}")
for e in errors:
    print("  ", e)
