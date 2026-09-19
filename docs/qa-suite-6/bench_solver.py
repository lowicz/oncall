"""QA6: solver sweep over budget x horizon x mode x anchor.

Drives the real async path (`/scheduling/runs` -> worker -> draft), so what is
measured is what a coordinator waits for, not a library call.
"""
import json, sys, time
from datetime import date, timedelta
sys.path.insert(0, "docs/qa-suite-6")
from api import Api

api = Api("adam.nowicki")
START = date(2026, 10, 5)  # pierwszy dzien nieobjety opublikowanym grafikiem


def set_policy(mode, anchor, seconds, fw=3.0, cw=1.0, pw=2.0):
    r = api.put("/api/v1/scheduling/policy", json={
        "rotation_mode": mode, "late_shift_anchor": anchor, "solve_seconds": seconds,
        "fairness_weight": fw, "continuity_weight": cw, "preference_weight": pw,
    })
    r.raise_for_status()
    return r.json()


def run(days):
    end = START + timedelta(days=days - 1)
    t0 = time.monotonic()
    r = api.post("/api/v1/scheduling/runs",
                 json={"starts_on": START.isoformat(), "ends_on": end.isoformat()})
    r.raise_for_status()
    rid = r.json()["id"]
    while True:
        time.sleep(1)
        st = api.get(f"/api/v1/scheduling/runs/{rid}").json()
        if st["status"] in ("completed", "failed"):
            break
        if time.monotonic() - t0 > 900:
            st["status"] = "timeout"
            break
    wall = time.monotonic() - t0
    return st, wall


def draft_quality(schedule_id):
    d = api.get(f"/api/v1/scheduling/{schedule_id}").json()
    imp = api.get(f"/api/v1/scheduling/{schedule_id}/fairness-impact").json()
    return d, imp


def cleanup(schedule_id):
    api.delete(f"/api/v1/scheduling/{schedule_id}")


def main():
    global START
    grid = json.loads(sys.argv[1]) if len(sys.argv) > 1 else None
    if grid and grid.get("start"):
        START = date.fromisoformat(grid["start"])
    if grid is None:
        grid = {"budgets": [5, 15, 30, 60, 120], "horizons": [7, 14, 28, 35],
                "modes": ["hybrid"], "anchors": ["secondary"]}
    out = []
    for mode in grid["modes"]:
        for anchor in grid["anchors"]:
            for budget in grid["budgets"]:
                for days in grid["horizons"]:
                    set_policy(mode, anchor, budget)
                    st, wall = run(days)
                    rec = {"mode": mode, "anchor": anchor, "budget": budget,
                           "days": days, "status": st["status"], "wall": round(wall, 1),
                           "error": st.get("error"), "conflicts": st.get("conflicts")}
                    if st["status"] == "completed" and st.get("schedule_id"):
                        d, imp = draft_quality(st["schedule_id"])
                        rec["solver_status"] = d.get("solver_status")
                        rec["acceptance_floor"] = imp.get("acceptance_floor")
                        rec["warnings"] = [w.get("message", w) if isinstance(w, dict) else w
                                           for w in (d.get("warnings") or [])]
                        rec["spreads"] = imp.get("spreads")
                        rec["criterion_met"] = imp.get("criterion_met")
                        cleanup(st["schedule_id"])
                    print(json.dumps(rec, ensure_ascii=False), flush=True)
                    out.append(rec)
    with open(grid.get("out", "docs/qa-suite-6/bench.jsonl"), "w") as fh:
        for rec in out:
            fh.write(json.dumps(rec, ensure_ascii=False) + "\n")


main()
