"""Z1 proof: three 28-day drafts through the production async path, primary
spread read from the draft_fairness_impact metric (the product's own number)."""
import json
import sys
import time
from datetime import date, timedelta

from qa import Client

client = Client("ola.zielinska")
starts = date(2026, 9, 7)
ends = starts + timedelta(days=27)

def measure(rep, schedule_id, elapsed):
    impact = client.get(f"/api/v1/scheduling/{schedule_id}/fairness-impact").json()
    projected = impact["projected_members"]
    spreads = {
        lens: round(max(m[lens]["deviation"] for m in projected)
                    - min(m[lens]["deviation"] for m in projected), 2)
        for lens in ("primary", "secondary", "late_shift", "weekends", "holidays")
    }
    record = {"rep": rep, "elapsed": elapsed, "schedule_id": schedule_id,
              "po": spreads, "max_oceniane": max(spreads[l] for l in ("primary", "secondary", "weekends", "holidays"))}
    out.append(record)
    print(json.dumps(record, ensure_ascii=False), flush=True)
    client.delete(f"/api/v1/scheduling/{schedule_id}")


out = []
for rep in range(1, 4):
    run = client.post(
        "/api/v1/scheduling/runs", json={"starts_on": starts.isoformat(), "ends_on": ends.isoformat()}
    )
    assert run.status_code == 202, run.text
    run_id = run.json()["id"]
    began = time.time()
    while True:
        status = client.get(f"/api/v1/scheduling/runs/{run_id}").json()
        if status["status"] in ("completed", "failed"):
            break
        time.sleep(3)
    elapsed = round(time.time() - began, 1)
    if status["status"] != "completed":
        print(json.dumps({"rep": rep, "status": status}), flush=True)
        continue
    schedule_id = status["schedule_id"]
    measure(rep, schedule_id, elapsed)

primaries = [r["po"]["primary"] for r in out]
print("primary spread:", primaries, "-> PASS" if out and max(primaries) <= 2.0 else "-> FAIL")
sys.exit(0 if out and max(primaries) <= 2.0 else 1)
