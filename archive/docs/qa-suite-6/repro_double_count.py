"""QA6/BLK-01: draft fairness forecast counts an already-published range twice.

Generates a draft over days that a published schedule already covers, which is
the regeneration path the product documents, and compares the forecast with the
duty totals that publication would actually produce.
"""
import sys, time
from datetime import date, timedelta
sys.path.insert(0, "docs/qa-suite-6")
from api import Api

api = Api("adam.nowicki")
pub = api.get("/api/v1/schedules/published").json()
print("opublikowany:", pub["starts_on"], "-", pub["ends_on"], "wersja", pub["version"])

s, e = date(2026, 9, 21), date(2026, 10, 4)   # w calosci wewnatrz opublikowanego
api.put("/api/v1/scheduling/policy", json={"rotation_mode": "hybrid", "solve_seconds": 15})
r = api.post("/api/v1/scheduling/runs", json={"starts_on": s.isoformat(), "ends_on": e.isoformat()})
rid = r.json()["id"]
while True:
    time.sleep(2)
    st = api.get(f"/api/v1/scheduling/runs/{rid}").json()
    if st["status"] in ("completed", "failed"):
        break
print("run:", st["status"], st.get("error"))
sid = st["schedule_id"]

imp = api.get(f"/api/v1/scheduling/{sid}/fairness-impact").json()
print("\nrozpietosci wg prognozy:")
for sp in imp["spreads"]:
    print(f"  {sp['lens']:10} przed={sp['before']:6.2f} po={sp['after']:6.2f} "
          f"kryterium={'TAK' if sp['meets_criterion'] else 'NIE'}")

# Suma punktow primary w prognozie 'po' vs to, co da publikacja.
after_total = sum(m["primary"]["actual"] for m in imp["projected_members"])
before_total = sum(m["primary"]["actual"] for m in imp["baseline_members"])
draft = api.get(f"/api/v1/scheduling/{sid}").json()
draft_primary_days = [a for a in draft["assignments"] if a["role"] == "primary"]
import holidays as hl
pl = {x for x in hl.country_holidays("PL", years=[2026])}
def w(ds):
    d = date.fromisoformat(ds)
    return 2.0 if d.weekday() >= 5 or d in pl else 1.0
draft_points = sum(w(a["service_date"]) for a in draft_primary_days)

print(f"\nsuma punktow PRIMARY w oknie:")
print(f"  przed publikacja szkicu (baseline) : {before_total}")
print(f"  prognoza 'po'                      : {after_total}")
print(f"  punkty PRIMARY w samym szkicu      : {draft_points}")
print(f"  po - przed                         : {after_total - before_total}")
print()
print("Publikacja NIE dodaje dyzurow, tylko podmienia obsade tych samych slotow,")
print("wiec suma po publikacji musi byc rowna sumie przed. Roznica rowna punktom")
print("szkicu oznacza, ze prognoza liczy te same dni dwa razy.")
print(f"\nWERDYKT: {'DEFEKT - podwojne liczenie' if abs((after_total-before_total)-draft_points) < 0.01 else 'ok'}")
print(f"szkic do usuniecia: {sid}")
