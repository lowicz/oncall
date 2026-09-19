"""QA6: powtarzalnosc wyniku przy 2 i 8 workerach CP-SAT na przydziale 2 CPU."""
import json, subprocess, sys, time
from datetime import date, timedelta
sys.path.insert(0, "docs/qa-suite-6")
from api import Api

REPEATS = 3
START, DAYS, BUDGET = date(2026, 10, 5), 28, 15


def set_workers(n):
    env = open(".env").read().splitlines()
    env = [l for l in env if not l.startswith("ONCALL_SOLVER_WORKERS")]
    env.append(f"ONCALL_SOLVER_WORKERS={n}")
    open(".env", "w").write("\n".join(env) + "\n")
    subprocess.run(["docker", "compose", "up", "-d", "worker"],
                   cwd=".", capture_output=True)
    time.sleep(8)


api = Api("adam.nowicki")
api.put("/api/v1/scheduling/policy", json={
    "rotation_mode": "hybrid", "late_shift_anchor": "secondary", "solve_seconds": BUDGET})

for workers in (8, 2):
    set_workers(workers)
    print(f"\n=== ONCALL_SOLVER_WORKERS={workers} (przydzial 2 CPU) ===")
    for i in range(REPEATS):
        end = START + timedelta(days=DAYS - 1)
        t0 = time.monotonic()
        rid = api.post("/api/v1/scheduling/runs", json={
            "starts_on": START.isoformat(), "ends_on": end.isoformat()}).json()["id"]
        while True:
            time.sleep(1)
            st = api.get(f"/api/v1/scheduling/runs/{rid}").json()
            if st["status"] in ("completed", "failed"):
                break
        wall = time.monotonic() - t0
        sid = st["schedule_id"]
        d = api.get(f"/api/v1/scheduling/{sid}").json()
        imp = api.get(f"/api/v1/scheduling/{sid}/fairness-impact").json()
        sp = {s["lens"]: s["after"] for s in imp["spreads"]}
        print(f"  proba {i+1}: wall={wall:5.1f}s {d['solver_status']:8} "
              f"kryterium={'TAK' if imp['criterion_met'] else 'NIE'}  {sp}")
        api.delete(f"/api/v1/scheduling/{sid}")
