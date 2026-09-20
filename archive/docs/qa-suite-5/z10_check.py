"""Z10 e2e: konflikt niedostępności widoczny w odpowiedzi o szkicu.

Odtwarza par. 7.1 z QA-REPORT-5: szkic na listopad, dwa dni „nie mogę" na
osobę, która ma w nich dyżur, i sprawdza, co dostaje ekran generatora.
"""
import sys, time
sys.path.insert(0, "/home/lowicz/Work/oncall/docs/qa-suite-5")
from qa import Client

USERNAMES = {
    "Anna Kowalska": "anna.kowalska", "Bartosz Mazur": "bartosz.mazur",
    "Julia Nowak": "julia.nowak", "Katarzyna Dąbrowska": "katarzyna.dabrowska",
    "Magdalena Woźniak": "magdalena.wozniak", "Marek Wiśniewski": "marek.wisniewski",
    "Ola Zielińska": "ola.zielinska", "Piotr Lewandowski": "piotr.lewandowski",
    "Rafał Kamiński": "rafal.kaminski", "Tomasz Szymański": "tomasz.szymanski",
}

koord = Client("ola.zielinska")
start, end = "2026-11-02", "2026-11-29"

run = koord.post("/api/v1/scheduling/runs", json={"starts_on": start, "ends_on": end})
run.raise_for_status()
run_id = run.json()["id"]
while True:
    state = koord.get(f"/api/v1/scheduling/runs/{run_id}").json()
    if state["status"] in ("completed", "failed"):
        break
    time.sleep(3)
assert state["status"] == "completed", state
draft_id = state["schedule_id"]
draft = koord.get(f"/api/v1/scheduling/{draft_id}").json()
print("szkic:", draft["name"], draft["solver_status"])
print("konflikty przed wpisem:", draft["unavailability_conflicts"])
assert draft["unavailability_conflicts"] == []

# Dwa dni z przydziałem dla jednej osoby, wpisane PO wygenerowaniu szkicu.
mine = [a for a in draft["assignments"] if a["role"] == "primary"][:2]
name = mine[0]["assignee_name"]
days = sorted({a["service_date"] for a in draft["assignments"]
               if a["assignee_name"] == name and a["role"] == "primary"})[:2]
owner = Client(USERNAMES[name])
created = []
for day in days:
    response = owner.post(
        "/api/v1/availability/me",
        json={"kind": "unavailable", "starts_on": day, "ends_on": day, "note": "QA Z10"},
    )
    response.raise_for_status()
    created.append(response.json()["id"])
print(f"wpisano „nie mogę\": {name} {days}")

after = koord.get(f"/api/v1/scheduling/{draft_id}").json()
print("konflikty po wpisie:", after["unavailability_conflicts"])
propose = koord.post(f"/api/v1/scheduling/{draft_id}/propose",
                     json={"expected_version": after["version"]})
print("propose:", propose.status_code, propose.json()["detail"]["message"])
print("409 conflicts:", propose.json()["detail"]["conflicts"])

for item in created:
    owner.delete(f"/api/v1/availability/me/{item}")
koord.delete(f"/api/v1/scheduling/{draft_id}")
print("posprzątano")
