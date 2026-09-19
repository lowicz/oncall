"""Z11 e2e: ostrzeżenia solvera na ekranie generatora.

Par. 7.8 z QA-REPORT-5: siedem z dziesięciu osób niedostępnych na cały marzec
2027, generowanie kończy się z zawieszonymi regułami rozrzedzania. Sprawdza,
czy odpowiedź o szkicu niesie ostrzeżenie solvera oddzielnie od reguł, i czy
reguły podają nazwiska i dni.
"""
import sys
import time

sys.path.insert(0, "/home/lowicz/Work/oncall/docs/qa-suite-5")
from qa import Client

ABSENT = [
    "anna.kowalska", "julia.nowak", "katarzyna.dabrowska", "magdalena.wozniak",
    "marek.wisniewski", "piotr.lewandowski", "tomasz.szymanski",
]
START, END = "2027-03-01", "2027-03-28"

entries = []
for username in ABSENT:
    client = Client(username)
    response = client.post("/api/v1/availability/me", json={
        "kind": "unavailable", "starts_on": START, "ends_on": END, "note": "QA Z11",
    })
    response.raise_for_status()
    entries.append((client, response.json()["id"]))
print(f"niedostępnych: {len(entries)} z 10 na {START}..{END}")

koord = Client("ola.zielinska")
run = koord.post("/api/v1/scheduling/runs", json={"starts_on": START, "ends_on": END})
run.raise_for_status()
run_id = run.json()["id"]
while True:
    state = koord.get(f"/api/v1/scheduling/runs/{run_id}").json()
    if state["status"] in ("completed", "failed"):
        break
    time.sleep(3)
print("run:", state["status"], state.get("error") or "")

if state["status"] == "completed":
    draft = koord.get(f"/api/v1/scheduling/{state['schedule_id']}").json()
    print("CP-SAT:", draft["solver_status"])
    for warning in draft["warnings"]:
        print(f"  [{warning['source']}] {warning['message']}")
    koord.delete(f"/api/v1/scheduling/{state['schedule_id']}")

for client, entry_id in entries:
    client.delete(f"/api/v1/availability/me/{entry_id}")
print("posprzątano")
