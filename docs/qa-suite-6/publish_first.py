import sys, time, json
from datetime import date, timedelta
sys.path.insert(0, "docs/qa-suite-6")
from api import Api

api = Api("adam.nowicki")
print("suggested-range:", api.get("/api/v1/scheduling/suggested-range").json())
api.put("/api/v1/scheduling/policy", json={"rotation_mode": "hybrid",
        "late_shift_anchor": "secondary", "solve_seconds": 30,
        "fairness_weight": 3.0, "continuity_weight": 1.0, "preference_weight": 2.0})

s, e = date(2026, 9, 7), date(2026, 10, 4)
r = api.post("/api/v1/scheduling/runs", json={"starts_on": s.isoformat(), "ends_on": e.isoformat()})
rid = r.json()["id"]
while True:
    time.sleep(2)
    st = api.get(f"/api/v1/scheduling/runs/{rid}").json()
    print("  ", st["status"], st["progress"])
    if st["status"] in ("completed", "failed"):
        break
print(json.dumps(st, ensure_ascii=False)[:500])
sid = st["schedule_id"]
d = api.get(f"/api/v1/scheduling/{sid}").json()
print("draft:", d["name"], d["status"], d["version"], d.get("solver_status"), d.get("warnings"))
r = api.post(f"/api/v1/scheduling/{sid}/propose", json={"expected_version": d["version"]})
print("propose:", r.status_code, r.text[:200])
d = r.json()
r = api.post(f"/api/v1/scheduling/{sid}/publish", json={"expected_version": d["version"]})
print("publish:", r.status_code, r.text[:300])
