"""QA7: run one generation through the API and report timing. Usage: generate.py START END [solve_seconds] [mode]"""
import sys, time, json
sys.path.insert(0, "docs/qa-suite-7")
from api import Api
s, e = sys.argv[1], sys.argv[2]
a = Api("tomasz.krawczyk")
pol = a.get("/api/v1/scheduling/policy").json()
if len(sys.argv) > 3:
    pol["solve_seconds"] = float(sys.argv[3])
if len(sys.argv) > 4:
    pol["rotation_mode"] = sys.argv[4]
body = {k: pol[k] for k in ("rotation_mode", "late_shift_anchor", "solve_seconds", "fairness_weight", "continuity_weight", "preference_weight")}
r = a.put("/api/v1/scheduling/policy", json=body); assert r.status_code == 200, r.text
t = time.time()
r = a.post("/api/v1/scheduling/runs", json={"starts_on": s, "ends_on": e}); run = r.json()
while run["status"] not in ("completed", "failed"):
    time.sleep(1)
    run = a.get(f"/api/v1/scheduling/runs/{run['id']}").json()
wall = time.time() - t
out = {"range": [s, e], "mode": body["rotation_mode"], "budget": body["solve_seconds"], "wall": round(wall, 1), "status": run["status"]}
if run["status"] == "completed":
    d = a.get(f"/api/v1/scheduling/{run['schedule_id']}").json()
    imp = a.get(f"/api/v1/scheduling/{run['schedule_id']}/fairness-impact").json()
    out.update(schedule_id=run["schedule_id"], solver=d["solver_status"], floor=d["acceptance_floor"], warnings=d["warnings"])
    out["impact"] = {k: v for k, v in imp.items() if not isinstance(v, list)}
    out["spreads"] = imp.get("spreads") or imp.get("lenses")
else:
    out.update(error=run.get("error"), conflicts=run.get("conflicts"))
print(json.dumps(out, ensure_ascii=False))
