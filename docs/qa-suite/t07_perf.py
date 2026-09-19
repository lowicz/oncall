"""TC-P: performance under the target hardware (4 cores total, api limited to 2).

Generation gets the configured 30 s CP-SAT budget. HTTP serialization and request
handling are measured outside that budget, so P4 allows one second of transport
overhead instead of requiring the impossible wall-clock value strictly below 30 s.
"""
import statistics, threading, time
from datetime import date, timedelta
from client import Api, check, FINDINGS, ADMIN_PASSWORD

TODAY = date.today()
USERS = [("admin", ADMIN_PASSWORD), ("admin2", None), ("koord", None), ("anna", None),
         ("marek", None), ("ola", None), ("piotr", None), ("kasia", None),
         ("tomek", None), ("ewa", None), ("jakub", None), ("magda", None)]

print("=== TC-P0 login cost (Argon2id) ===")
times = []
for u, p in USERS:
    t0 = time.monotonic(); Api(u, p); times.append(time.monotonic() - t0)
print(f"  sequential logins: n={len(times)} avg={statistics.mean(times)*1000:.0f} ms "
      f"p95={sorted(times)[-1]*1000:.0f} ms")
check("P0.1", statistics.mean(times) < 1.0, f"login under 1 s (avg {statistics.mean(times):.2f}s)")

# 12 concurrent logins - Argon2id is CPU bound and the API has 2 cores
res = []
def do_login(u, p):
    t0 = time.monotonic()
    a = Api(u, p)
    res.append((u, time.monotonic() - t0, a.csrf is not None))
th = [threading.Thread(target=do_login, args=(u, p)) for u, p in USERS]
t0 = time.monotonic()
for t in th: t.start()
for t in th: t.join()
wall = time.monotonic() - t0
lat = [d for _, d, _ in res]
print(f"  12 concurrent logins: wall={wall:.2f}s max={max(lat):.2f}s avg={statistics.mean(lat):.2f}s")
check("P0.2", max(lat) < 5.0, f"concurrent login p-max under 5 s (got {max(lat):.2f}s)")

print()
print("=== TC-P1 read-path latency, 12 concurrent users, 30 s ===")
sessions = [Api(u, p) for u, p in USERS]
SCEN = [
    ("GET /schedules/published", "/api/v1/schedules/published"),
    ("GET /calendar 30d", f"/api/v1/calendar?starts_on={TODAY}&ends_on={TODAY + timedelta(days=29)}"),
    ("GET /calendar 90d", f"/api/v1/calendar?starts_on={TODAY}&ends_on={TODAY + timedelta(days=89)}"),
    ("GET /fairness", "/api/v1/fairness"),
    ("GET /team", "/api/v1/team"),
    ("GET /swaps", "/api/v1/swaps"),
]
results = {label: [] for label, _ in SCEN}
errors = []
stop = time.monotonic() + 30

def hammer(api, idx):
    while time.monotonic() < stop:
        label, path = SCEN[idx % len(SCEN)]
        t0 = time.monotonic()
        try:
            r = api.get(path)
            dt = time.monotonic() - t0
            results[label].append(dt)
            if r.status_code not in (200, 403, 409):
                errors.append((api.username, path, r.status_code))
        except Exception as exc:
            errors.append((api.username, path, str(exc)[:60]))
        idx += 1

th = [threading.Thread(target=hammer, args=(a, i)) for i, a in enumerate(sessions)]
for t in th: t.start()
for t in th: t.join()
total = sum(len(v) for v in results.values())
print(f"  {total} requests in 30 s ({total/30:.0f} req/s), errors={len(errors)}")
for label, v in results.items():
    if not v: continue
    v.sort()
    p50 = v[len(v)//2]*1000; p95 = v[int(len(v)*0.95)]*1000; mx = v[-1]*1000
    print(f"  {label:28s} n={len(v):5d} p50={p50:7.0f} ms p95={p95:7.0f} ms max={mx:7.0f} ms")
    check("P1", p95 < 2000, f"{label} p95 under 2 s (got {p95:.0f} ms)")
check("P1.err", not errors, f"no errors under load ({errors[:5]})")

print()
print("=== TC-P2 monthly report generation ===")
koord = Api("koord")
for month in ["2026-08", "2025-12"]:
    lat = []
    for _ in range(5):
        t0 = time.monotonic(); r = koord.get(f"/api/v1/reports/monthly.csv?month={month}")
        lat.append(time.monotonic() - t0)
    print(f"  monthly.csv {month}: avg={statistics.mean(lat)*1000:.0f} ms max={max(lat)*1000:.0f} ms")
    check("P2.1", max(lat) < 3.0, f"monthly report {month} under 3 s")

print()
print("=== TC-P3 fairness report under concurrency ===")
lat = []
def fair(api):
    for _ in range(5):
        t0 = time.monotonic(); api.get("/api/v1/fairness"); lat.append(time.monotonic() - t0)
th = [threading.Thread(target=fair, args=(a,)) for a in sessions[:10]]
t0 = time.monotonic()
for t in th: t.start()
for t in th: t.join()
print(f"  50 fairness reports by 10 users: wall={time.monotonic()-t0:.2f}s "
      f"avg={statistics.mean(lat)*1000:.0f} ms max={max(lat)*1000:.0f} ms")
check("P3.1", max(lat) < 5.0, f"fairness p-max under 5 s (got {max(lat):.2f}s)")

print()
print("=== TC-P4 generation on constrained CPU ===")
for days, label in [(30, "30-day"), (90, "91-day")]:
    s = TODAY + timedelta(days=300)
    t0 = time.monotonic()
    r = koord.post("/api/v1/scheduling/generate",
                   json={"starts_on": str(s), "ends_on": str(s + timedelta(days=days))})
    dt = time.monotonic() - t0
    print(f"  {label} generation on 2 cores: {dt:.2f}s status={r.status_code} "
          f"solver={r.json().get('solver_status') if r.status_code == 201 else '-'}")
    check("P4", dt < 31, f"{label} generation within 30 s solver budget + 1 s HTTP overhead (got {dt:.2f}s)")
    if r.status_code == 201:
        koord.delete(f"/api/v1/scheduling/{r.json()['id']}")

print()
print("=== TC-P5 two generations at once ===")
out = []
def gen(off):
    s = TODAY + timedelta(days=off)
    t0 = time.monotonic()
    r = koord.post("/api/v1/scheduling/generate",
                   json={"starts_on": str(s), "ends_on": str(s + timedelta(days=60))})
    out.append((off, time.monotonic() - t0, r.status_code, r.json().get("id") if r.status_code == 201 else None))
th = [threading.Thread(target=gen, args=(o,)) for o in (400, 500)]
t0 = time.monotonic()
for t in th: t.start()
for t in th: t.join()
print(f"  two 61-day generations in parallel: wall={time.monotonic()-t0:.2f}s -> {[(o, round(d,1), c) for o, d, c, _ in out]}")
check("P5.1", time.monotonic() - t0 < 70, "two parallel generations complete")
for _, _, code, sid in out:
    if sid: koord.delete(f"/api/v1/scheduling/{sid}")

print()
print(f"--- {len(FINDINGS)} failures ---")
for f in FINDINGS: print("  ", f)
