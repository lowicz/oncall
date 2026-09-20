"""Z13 e2e: trwające generowanie widać po przeładowaniu strony.

Uruchamia generowanie, a potem - tak jak świeżo załadowany ekran, który nie
zna identyfikatora zadania - pyta o listę trwających uruchomień.
"""
import sys
import time

sys.path.insert(0, "/home/lowicz/Work/oncall/docs/qa-suite-5")
from qa import Client

koord = Client("ola.zielinska")
start = koord.post(
    "/api/v1/scheduling/runs", json={"starts_on": "2027-05-03", "ends_on": "2027-05-30"}
)
start.raise_for_status()
run_id = start.json()["id"]
print("zlecono:", run_id)

# Nowa sesja przeglądarki: żadnej wiedzy o run_id.
reloaded = Client("ola.zielinska")
for _ in range(20):
    active = reloaded.get("/api/v1/scheduling/runs").json()
    if active:
        break
    time.sleep(1)
print("trwające po przeładowaniu:", [
    (item["id"], item["status"], item["progress"], item["solve_seconds"]) for item in active
])
assert any(item["id"] == run_id for item in active), active

while True:
    state = koord.get(f"/api/v1/scheduling/runs/{run_id}").json()
    if state["status"] in ("completed", "failed"):
        break
    time.sleep(3)
print("koniec:", state["status"])
print("lista po zakończeniu:", reloaded.get("/api/v1/scheduling/runs").json())
if state["schedule_id"]:
    koord.delete(f"/api/v1/scheduling/{state['schedule_id']}")
print("posprzątano")
