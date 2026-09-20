"""QA6: co sie dzieje, gdy dwoje koordynatorow generuje naraz, a zespol
w tym czasie normalnie pracuje.

Worker ma jedna petle: drain_outbox -> process_schedule_run (jeden bieg) ->
scan_handover. Sprawdzamy dwie rzeczy: czy drugie generowanie czeka na pierwsze
i czy powiadomienia powstale w trakcie generowania czekaja do jego konca.
"""
import subprocess, sys, time
from datetime import date, timedelta
sys.path.insert(0, "docs/qa-suite-6")
from api import Api

SQL = ("select coalesce(status::text,'?'), count(*) from notification_outbox "
       "where created_at > now() - interval '15 minutes' group by 1 order by 1;")


def outbox():
    r = subprocess.run(
        ["docker", "compose", "exec", "-T", "db", "psql", "-U", "oncall", "-d", "oncall",
         "-t", "-A", "-F", "=", "-c", SQL],
        capture_output=True, text=True, cwd=".")
    out = " ".join(r.stdout.split())
    return out or "pusty"


a = Api("adam.nowicki")        # koordynator 1
k = Api("karolina.master")     # koordynator 2
a.put("/api/v1/scheduling/policy", json={
    "rotation_mode": "hybrid", "late_shift_anchor": "secondary", "solve_seconds": 60})

s1, e1 = date(2027, 6, 1), date(2027, 6, 28)
s2, e2 = date(2027, 7, 1), date(2027, 7, 28)
t0 = time.monotonic()
r1 = a.post("/api/v1/scheduling/runs",
            json={"starts_on": s1.isoformat(), "ends_on": e1.isoformat()}).json()
r2 = k.post("/api/v1/scheduling/runs",
            json={"starts_on": s2.isoformat(), "ends_on": e2.isoformat()}).json()
print(f"t= 0.0s  dwa generowania 28 dni zakolejkowane naraz (budzet 60 s kazde)")

# Czlonek zespolu sklada zamiane w trakcie: powinna wyslac powiadomienie.
time.sleep(5)
pub = a.get("/api/v1/schedules/published").json()
slots = {(x["service_date"], x["role"]): x["assignee_name"] for x in pub["assignments"]}
LOGIN = {"Adam Nowicki": "adam.nowicki", "Beata Lis": "beata.lis", "Cezary Dudek": "cezary.dudek",
    "Dorota Pawlak": "dorota.pawlak", "Emil Zając": "emil.zajac", "Filip Górski": "filip.gorski",
    "Grażyna Wilk": "grazyna.wilk", "Hubert Baran": "hubert.baran",
    "Iwona Sadowska": "iwona.sadowska", "Jakub Polak": "jakub.polak"}
made = None
for (day, role), who in sorted(slots.items()):
    if role != "primary" or date.fromisoformat(day).weekday() >= 5:
        continue
    api = Api(LOGIN[who])
    for o in api.get("/api/v1/swaps/options",
                     params={"service_date": day, "role": role}).json():
        rr = api.post("/api/v1/swaps", json={
            "schedule_id": pub["id"], "service_date": day, "role": role,
            "replacement_member_id": o["member_id"], "note": "QA6 obciazenie"})
        if rr.status_code == 201:
            made = (api, rr.json()["id"])
            print(f"t={time.monotonic()-t0:5.1f}s  zamiana zlozona ({who}, {day}) "
                  f"-> powiadomienie powinno wyjsc")
            break
    if made:
        break

done = {}
while len(done) < 2 and time.monotonic() - t0 < 400:
    st1 = a.get(f"/api/v1/scheduling/runs/{r1['id']}").json()
    st2 = k.get(f"/api/v1/scheduling/runs/{r2['id']}").json()
    el = time.monotonic() - t0
    for tag, st in (("A", st1), ("B", st2)):
        if st["status"] in ("completed", "failed") and tag not in done:
            done[tag] = el
    print(f"t={el:5.1f}s  A={st1['status']:9}({st1['progress']:3})  "
          f"B={st2['status']:9}({st2['progress']:3})  outbox: {outbox()}")
    time.sleep(10)

print()
for tag, el in sorted(done.items()):
    print(f"generowanie {tag} zakonczone po {el:.1f} s")
time.sleep(10)
print(f"outbox po wszystkim: {outbox()}")

if made:
    made[0].post(f"/api/v1/swaps/{made[1]}/cancel", json={"reason": "QA6"})
for st in (a.get(f"/api/v1/scheduling/runs/{r1['id']}").json(),
           k.get(f"/api/v1/scheduling/runs/{r2['id']}").json()):
    if st.get("schedule_id"):
        a.delete(f"/api/v1/scheduling/{st['schedule_id']}")
