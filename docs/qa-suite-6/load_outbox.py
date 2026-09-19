"""QA6: czy dlugie generowanie wstrzymuje powiadomienia?

Worker ma jedna petle: drain_outbox -> process_schedule_run -> scan_handover.
Generowanie jest synchroniczne wewnatrz tej petli, wiec sprawdzamy, czy wiersze
outboxu powstale w trakcie generowania czekaja do jego konca.
"""
import subprocess, sys, time
from datetime import date, timedelta
sys.path.insert(0, "docs/qa-suite-6")
from api import Api

SQL = ("select status, count(*) from notification_outbox "
       "where created_at > now() - interval '10 minutes' group by status;")


def outbox():
    r = subprocess.run(
        ["docker", "compose", "exec", "-T", "db", "psql", "-U", "oncall", "-d", "oncall",
         "-t", "-A", "-F", ",", "-c", SQL],
        capture_output=True, text=True, cwd=".")
    return r.stdout.strip() or "(brak)"


coord = Api("adam.nowicki")
coord.put("/api/v1/scheduling/policy",
          json={"rotation_mode": "hybrid", "late_shift_anchor": "secondary", "solve_seconds": 60})

s = date(2027, 6, 1)
e = s + timedelta(days=27)
t0 = time.monotonic()
r = coord.post("/api/v1/scheduling/runs",
               json={"starts_on": s.isoformat(), "ends_on": e.isoformat()})
rid = r.json()["id"]
print(f"t=0.0s  zakolejkowano generowanie 28 dni, budzet 60 s (run {rid})")

# Zamiana skladana w trakcie generowania: powinna od razu trafic do outboxu
# i zostac wyslana przez workera.
time.sleep(6)
pub = coord.get("/api/v1/schedules/published").json()
iwona = Api("iwona.sadowska")
opts = iwona.get("/api/v1/swaps/options",
                 params={"service_date": "2026-10-03", "role": "primary"}).json()
made = None
for o in opts:
    rr = iwona.post("/api/v1/swaps", json={
        "schedule_id": pub["id"], "service_date": "2026-10-03", "role": "primary",
        "replacement_member_id": o["member_id"], "note": "QA6 outbox"})
    if rr.status_code == 201:
        made = rr.json()["id"]
        break
print(f"t={time.monotonic()-t0:5.1f}s  zamiana zlozona: {'tak' if made else 'nie (reguly twarde)'}")

while True:
    st = coord.get(f"/api/v1/scheduling/runs/{rid}").json()
    el = time.monotonic() - t0
    print(f"t={el:5.1f}s  run={st['status']:9} postep={st['progress']:3}  outbox: {outbox()}")
    if st["status"] in ("completed", "failed"):
        break
    if el > 400:
        break
    time.sleep(10)

time.sleep(8)
print(f"t={time.monotonic()-t0:5.1f}s  po zakonczeniu   outbox: {outbox()}")
if made:
    iwona.post(f"/api/v1/swaps/{made}/cancel", json={"reason": "QA6"})
if st.get("schedule_id"):
    coord.delete(f"/api/v1/scheduling/{st['schedule_id']}")
