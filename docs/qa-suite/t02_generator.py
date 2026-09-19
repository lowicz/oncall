"""TC-B: generator, draft workflow, publication, solution quality and timing.

Round 4 intentionally removed deterministic search. TC-B5 therefore compares
quality metrics of two complete solutions instead of assignment identity.
"""
import json, time
from datetime import date, timedelta
from client import Api, check, FINDINGS, ADMIN_PASSWORD

koord = Api("koord")
admin = Api("admin", ADMIN_PASSWORD)
TODAY = date.today()

print("=== TC-B1 policy ===")
r = koord.get("/api/v1/scheduling/policy")
print("policy:", r.json())
r = koord.put("/api/v1/scheduling/policy", json={"rotation_mode": "hybrid",
    "fairness_weight": 3.0, "continuity_weight": 1.0, "preference_weight": 2.0,
    "late_shift_anchor": "secondary"})
check("B1.1", r.status_code == 200, "policy update", r.text[:200])
for bad in [{"rotation_mode": "hybrid", "fairness_weight": -1},
            {"rotation_mode": "hybrid", "fairness_weight": 101},
            {"rotation_mode": "nonsense"}]:
    r = koord.put("/api/v1/scheduling/policy", json=bad)
    check("B1.2", r.status_code == 422, f"policy rejects {bad}", str(r.status_code))

print()
print("=== TC-B2 generate range validation ===")
start = TODAY + timedelta(days=30)
for payload, expect in [
    ({"starts_on": str(start), "ends_on": str(start - timedelta(days=1))}, 422),
    ({"starts_on": str(start), "ends_on": str(start + timedelta(days=91))}, 422),
]:
    r = koord.post("/api/v1/scheduling/generate", json=payload)
    check("B2.1", r.status_code == expect, f"generate rejects {payload}", str(r.status_code))

print()
print("=== TC-B3 91-day generation, timing (30 s solver budget + HTTP overhead) ===")
end = start + timedelta(days=90)
t0 = time.monotonic()
r = koord.post("/api/v1/scheduling/generate",
               json={"starts_on": str(start), "ends_on": str(end)})
elapsed = time.monotonic() - t0
print(f"91-day generation: {elapsed:.2f}s status={r.status_code}")
check("B3.1", r.status_code == 201, "91-day generation succeeds", r.text[:300])
check("B3.2", elapsed < 31, f"91-day generation within budget + 1 s overhead (took {elapsed:.2f}s)")
if r.status_code != 201:
    raise SystemExit("generation failed, stopping")
d1 = r.json()
print("solver_status:", d1["solver_status"], "assignments:", len(d1["assignments"]))

print()
print("=== TC-B4 hard rules in the generated draft ===")
by_day = {}
for a in d1["assignments"]:
    by_day.setdefault(a["service_date"], {})[a["role"]] = a["assignee_name"]
import holidays as ch
pl = set(ch.country_holidays("PL", years=range(start.year, end.year + 1)))
bad_same, bad_late, missing = [], [], []
for day, roles in by_day.items():
    d = date.fromisoformat(day)
    if roles.get("primary") == roles.get("secondary"):
        bad_same.append(day)
    working = d.weekday() < 5 and d not in pl
    if working and "late_shift" not in roles:
        missing.append(("late missing", day))
    if not working and "late_shift" in roles:
        bad_late.append(day)
    if "primary" not in roles or "secondary" not in roles:
        missing.append(("oncall missing", day))
check("B4.1", not bad_same, "primary != secondary every day", str(bad_same[:5]))
check("B4.2", not bad_late, "no 11-19 shift on days off", str(bad_late[:5]))
check("B4.3", not missing, "full coverage", str(missing[:5]))
check("B4.4", len(by_day) == 91, f"91 days covered (got {len(by_day)})")

# hard unavailability
team = {m["display_name"]: m for m in koord.get("/api/v1/team").json()}
avail_violations = []
UNAVAIL = [("Marek Nowak", TODAY + timedelta(days=30), TODAY + timedelta(days=44)),
           ("Katarzyna Lewandowska", TODAY + timedelta(days=35), TODAY + timedelta(days=38))]
for name, s, e in UNAVAIL:
    for day, roles in by_day.items():
        d = date.fromisoformat(day)
        if s <= d <= e and name in roles.values():
            avail_violations.append((name, day))
check("B4.5", not avail_violations, "hard unavailability respected", str(avail_violations[:5]))

# eligibility: Ewa has no primary, Jakub has no late_shift
elig_violations = []
for day, roles in by_day.items():
    if roles.get("primary") == "Ewa Kamińska":
        elig_violations.append(("Ewa primary", day))
    if roles.get("late_shift") == "Jakub Szymański":
        elig_violations.append(("Jakub late", day))
check("B4.6", not elig_violations, "role eligibility respected", str(elig_violations[:5]))

print()
print("=== TC-B5 quality across nondeterministic runs (PLAN par.8) ===")
t0 = time.monotonic()
r2 = koord.post("/api/v1/scheduling/generate",
                json={"starts_on": str(start), "ends_on": str(end)})
e2 = time.monotonic() - t0
print(f"second run: {e2:.2f}s")
d2 = r2.json()

def quality(assignments):
    counts = {}
    by_role = {}
    for item in assignments:
        key = (item["role"], item["assignee_name"])
        counts[key] = counts.get(key, 0) + 1
        by_role.setdefault(item["role"], set()).add(item["assignee_name"])
    spreads = []
    for role, people in by_role.items():
        values = [counts.get((role, person), 0) for person in team]
        spreads.append(max(values) - min(values))
    ordered = sorted(assignments, key=lambda item: (item["role"], item["service_date"]))
    handovers = sum(
        current["role"] == previous["role"]
        and current["assignee_name"] != previous["assignee_name"]
        and date.fromisoformat(current["service_date"]).isocalendar()[:2]
            == date.fromisoformat(previous["service_date"]).isocalendar()[:2]
        for previous, current in zip(ordered, ordered[1:])
    )
    return max(spreads, default=0), sum(spreads) + handovers

q1, q2 = quality(d1["assignments"]), quality(d2["assignments"])
check("B5.1", r2.status_code == 201 and len(d2["assignments"]) == len(d1["assignments"]),
      "both runs produce complete schedules", f"status={r2.status_code}, sizes={len(d1['assignments'])}/{len(d2.get('assignments', []))}")
check("B5.2", abs(q1[0] - q2[0]) <= 2,
      "both runs stay in the same load-spread threshold", f"quality={q1}/{q2}")
check("B5.3", abs(q1[1] - q2[1]) <= max(3, round(0.1 * max(q1[1], q2[1]))),
      "objective proxies remain within 10% (minimum tolerance 3)", f"quality={q1}/{q2}")

print()
print("=== TC-B6 draft workflow / optimistic locking ===")
sid = d2["id"]; ver = d2["version"]
r = koord.post(f"/api/v1/scheduling/{sid}/publish", json={"expected_version": ver})
check("B6.1", r.status_code == 409, "cannot publish a draft directly", str(r.status_code))
r = koord.post(f"/api/v1/scheduling/{sid}/propose", json={"expected_version": ver + 99})
check("B6.2", r.status_code == 409, "stale version rejected on propose", str(r.status_code))
r = koord.post(f"/api/v1/scheduling/{sid}/propose", json={"expected_version": ver})
check("B6.3", r.status_code == 200, "propose ok", r.text[:200])
pv = r.json()["version"]
r = koord.post(f"/api/v1/scheduling/{sid}/propose", json={"expected_version": pv})
check("B6.4", r.status_code == 409, "cannot re-propose a proposal", str(r.status_code))
r = koord.post(f"/api/v1/scheduling/{sid}/override", json={
    "expected_version": pv, "service_date": str(start), "role": "primary",
    "replacement_member_id": list(team.values())[0]["id"]})
check("B6.5", r.status_code == 404, "cannot edit a proposal cell", str(r.status_code))
r = koord.post(f"/api/v1/scheduling/{sid}/publish", json={"expected_version": pv})
check("B6.6", r.status_code == 200, "publish ok", r.text[:300])
published = r.json() if r.status_code == 200 else {}
r = koord.delete(f"/api/v1/scheduling/{sid}")
check("B6.7", r.status_code == 409, "published schedule not deletable", str(r.status_code))

print()
print("=== TC-B7 draft cell override rules ===")
s2 = TODAY + timedelta(days=140)
r = koord.post("/api/v1/scheduling/generate", json={"starts_on": str(s2), "ends_on": str(s2 + timedelta(days=13))})
check("B7.0", r.status_code == 201, "second draft generated", r.text[:200])
d3 = r.json(); sid3 = d3["id"]; v3 = d3["version"]
first = d3["assignments"][0]
day0 = first["service_date"]
cur_primary = [a for a in d3["assignments"] if a["service_date"] == day0 and a["role"] == "primary"][0]
cur_secondary = [a for a in d3["assignments"] if a["service_date"] == day0 and a["role"] == "secondary"][0]
sec_id = team[cur_secondary["assignee_name"]]["id"]
r = koord.post(f"/api/v1/scheduling/{sid3}/override", json={
    "expected_version": v3, "service_date": day0, "role": "primary", "replacement_member_id": sec_id})
check("B7.1", r.status_code == 422, "cannot put the same person in both on-call roles", str(r.status_code))
# out of range
r = koord.post(f"/api/v1/scheduling/{sid3}/override", json={
    "expected_version": v3, "service_date": str(TODAY), "role": "primary",
    "replacement_member_id": sec_id})
check("B7.2", r.status_code == 422, "date outside draft range rejected", str(r.status_code))
# ineligible person
ewa = team["Ewa Kamińska"]["id"]
r = koord.post(f"/api/v1/scheduling/{sid3}/override", json={
    "expected_version": v3, "service_date": day0, "role": "primary", "replacement_member_id": ewa})
check("B7.3", r.status_code == 422, "ineligible replacement rejected", str(r.status_code))
# valid override
other = [n for n in team if n not in (cur_primary["assignee_name"], cur_secondary["assignee_name"],
                                      "Ewa Kamińska")][0]
r = koord.post(f"/api/v1/scheduling/{sid3}/override", json={
    "expected_version": v3, "service_date": day0, "role": "primary",
    "replacement_member_id": team[other]["id"]})
check("B7.4", r.status_code == 200, "valid draft override", r.text[:200])
if r.status_code == 200:
    nv = r.json()["version"]
    check("B7.5", nv == v3 + 1, f"version bumped {v3} -> {nv}")
    r = koord.post(f"/api/v1/scheduling/{sid3}/override", json={
        "expected_version": v3, "service_date": day0, "role": "secondary",
        "replacement_member_id": team[other]["id"]})
    check("B7.6", r.status_code == 409, "stale draft version rejected", str(r.status_code))

print()
print("=== TC-B8 fairness impact of the draft ===")
r = koord.get(f"/api/v1/scheduling/{sid3}/fairness-impact")
check("B8.1", r.status_code == 200, "fairness impact endpoint", r.text[:200])
if r.status_code == 200:
    fi = r.json()
    check("B8.2", len(fi["baseline_members"]) == len(fi["projected_members"]),
          "baseline and projection cover the same people")

r = koord.delete(f"/api/v1/scheduling/{sid3}")
check("B8.3", r.status_code == 204, "draft deletable", str(r.status_code))

print()
print(f"--- {len(FINDINGS)} failures ---")
for f in FINDINGS: print("  ", f)
json.dump({"published": published.get("id"), "start": str(start), "end": str(end)},
          open("state_b.json", "w"))
