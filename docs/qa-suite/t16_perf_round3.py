"""Round-3 performance: report generation and reads while the solver runs.

Scenario: one coordinator runs a synchronous 30-day generation on the
constrained api container (2 cores), while 12 concurrent users repeatedly
fetch the monthly CSV report, the fairness report and the calendar matrix.
"""
import statistics
import sys
import threading
import time
from datetime import date, timedelta

from client import Api, PASSWORD

USERS = ["marek", "ola", "piotr", "kasia", "tomek", "ewa",
         "jakub", "magda", "rafal", "anna", "koord", "viewer"]

STOP = time.monotonic() + 30
LAT = {name: [] for name in ("monthly_csv", "fairness", "calendar", "published")}
ERR = []
EXPECTED_DENIED = []


def expected_status(login, kind):
    if kind == "monthly_csv" and login not in ("koord", "anna"):
        return 403
    if kind == "fairness" and login == "viewer":
        return 403
    return 200


def reader(login):
    api = Api(login, PASSWORD if login not in ("koord",) else PASSWORD)
    kinds = ("monthly_csv", "fairness", "calendar", "published")
    i = 0
    while time.monotonic() < STOP:
        kind = kinds[i % len(kinds)]
        i += 1
        if kind == "monthly_csv":
            path = "/api/v1/reports/monthly.csv?month=2026-08"
        elif kind == "fairness":
            path = "/api/v1/fairness"
        elif kind == "calendar":
            path = "/api/v1/calendar?starts_on=2026-09-05&ends_on=2026-10-04"
        else:
            path = "/api/v1/schedules/published"
        t0 = time.monotonic()
        r = api.get(path)
        dt = (time.monotonic() - t0) * 1000
        wanted = expected_status(login, kind)
        if r.status_code == 403 and wanted == 403:
            EXPECTED_DENIED.append((login, kind))
        elif r.status_code != wanted:
            ERR.append((login, kind, r.status_code))
        elif r.status_code == 200:
            LAT[kind].append(dt)
        time.sleep(0.05)


def main():
    failures = []
    threads = [threading.Thread(target=reader, args=(u,)) for u in USERS]
    for t in threads:
        t.start()

    koord = Api("koord")
    start = date.today() + timedelta(days=700)
    t0 = time.monotonic()
    r = koord.post("/api/v1/scheduling/generate", json={
        "starts_on": str(start), "ends_on": str(start + timedelta(days=29))})
    gen_dt = time.monotonic() - t0
    print(f"generation during load: {gen_dt:.1f}s status={r.status_code} "
          f"solver={r.json().get('solver_status') if r.status_code == 201 else r.text[:100]}")
    if r.status_code != 201 or gen_dt >= 31:
        failures.append(f"generation: status={r.status_code}, duration={gen_dt:.2f}s")
    if r.status_code == 201:
        koord.delete(f"/api/v1/scheduling/{r.json()['id']}")

    for t in threads:
        t.join()

    total = 0
    for kind, samples in LAT.items():
        if not samples:
            print(f"  {kind:12s} no samples")
            continue
        total += len(samples)
        p95 = sorted(samples)[int(len(samples) * 0.95) - 1]
        print(f"  {kind:12s} n={len(samples):4d} p50={statistics.median(samples):6.0f} ms "
              f"p95={p95:6.0f} ms max={max(samples):6.0f} ms")
        if p95 >= 2000:
            failures.append(f"{kind}: p95={p95:.0f}ms")
    print(f"  total reads={total} expected_denied={len(EXPECTED_DENIED)} "
          f"unexpected_errors={len(ERR)} {ERR[:5]}")
    if ERR:
        failures.append(f"unexpected read errors: {ERR[:5]}")
    print(f"\n--- {len(failures)} failures ---")
    for failure in failures:
        print(f"[FAIL] {failure}")
    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
