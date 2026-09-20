"""Z3 proof: the draft panel's "before" bar equals the plain history measured
in the projection window - no window drift mixed into the shown impact."""
import json
import time

from qa import Client

LENSES = ("primary", "secondary", "late_shift", "weekends", "holidays")

client = Client("ola.zielinska")
run = client.post(
    "/api/v1/scheduling/runs", json={"starts_on": "2026-09-07", "ends_on": "2026-10-04"}
)
run_id = run.json()["id"]
while True:
    status = client.get(f"/api/v1/scheduling/runs/{run_id}").json()
    if status["status"] in ("completed", "failed"):
        break
    time.sleep(3)
schedule_id = status["schedule_id"]
impact = client.get(f"/api/v1/scheduling/{schedule_id}/fairness-impact").json()
panel_before = {
    lens: round(
        max(m[lens]["deviation"] for m in impact["baseline_members"])
        - min(m[lens]["deviation"] for m in impact["baseline_members"]),
        2,
    )
    for lens in LENSES
}
client.delete(f"/api/v1/scheduling/{schedule_id}")
print(json.dumps({"przed_z_panelu": panel_before}, ensure_ascii=False))
