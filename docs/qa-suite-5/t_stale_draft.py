"""Reproduces the case from docs/blad_oncall.png end to end.

A draft is generated while everybody is available, then a member reports hard
unavailability inside the draft range. The question is what the product does
with a draft that no longer matches the data it was built from.
"""
import json
import time
from qa import Client

coordinator = Client("ola.zielinska")
START, END = "2026-11-02", "2026-11-29"

created = coordinator.post("/api/v1/scheduling/runs", json={"starts_on": START, "ends_on": END})
print("generate:", created.status_code, created.text[:200])
run_id = created.json()["id"]
began = time.perf_counter()
while True:
    run = coordinator.get(f"/api/v1/scheduling/runs/{run_id}").json()
    if run["status"] in ("completed", "failed"):
        break
    time.sleep(3)
print(f"run {run['status']} po {time.perf_counter() - began:.1f}s, postep={run['progress']}")
schedule_id = run["schedule_id"]
draft = coordinator.get(f"/api/v1/scheduling/drafts/{schedule_id}").json()
print("solver_status:", draft["solver_status"], "przydzialy:", len(draft["assignments"]))

# Pick a member who actually has duty in the draft, then block those very days.
victim = draft["assignments"][0]
days = sorted({a["service_date"] for a in draft["assignments"]
               if a["assignee_name"] == victim["assignee_name"]})[:4]
print(f"blokujemy {victim['assignee_name']} na {days[0]}..{days[-1]}")
username = {
    "Anna Kowalska": "anna.kowalska", "Marek Wiśniewski": "marek.wisniewski",
    "Ola Zielińska": "ola.zielinska", "Piotr Lewandowski": "piotr.lewandowski",
    "Katarzyna Dąbrowska": "katarzyna.dabrowska", "Tomasz Szymański": "tomasz.szymanski",
    "Magdalena Woźniak": "magdalena.wozniak", "Rafał Kamiński": "rafal.kaminski",
    "Julia Nowak": "julia.nowak", "Bartosz Mazur": "bartosz.mazur",
}[victim["assignee_name"]]
member = Client(username)
blocked = member.post("/api/v1/availability/me", json={
    "kind": "unavailable", "starts_on": days[0], "ends_on": days[-1],
    "note": "Zgloszone po wygenerowaniu szkicu",
})
print("zgloszenie niedostepnosci:", blocked.status_code, blocked.text[:160])

after = coordinator.get(f"/api/v1/scheduling/drafts/{schedule_id}").json()
clash = [a for a in after["assignments"]
         if a["assignee_name"] == victim["assignee_name"] and a["service_date"] in days]
print("kolizje w szkicu po zgloszeniu:", len(clash), clash[:3])
print("ostrzezenia szkicu:", after.get("warnings"), "konflikty:", after.get("conflicts"))
print("klucze odpowiedzi:", sorted(after.keys()))

proposed = coordinator.post(f"/api/v1/scheduling/drafts/{schedule_id}/propose",
                            json={"expected_version": after["version"]})
print("przekazanie do akceptacji:", proposed.status_code, proposed.text[:200])
if proposed.status_code < 300:
    version = proposed.json()["version"]
    published = coordinator.post(f"/api/v1/scheduling/drafts/{schedule_id}/publish",
                                 json={"expected_version": version})
    print("publikacja:", published.status_code, published.text[:200])
    calendar = coordinator.get("/api/v1/calendar",
                               params={"starts_on": days[0], "ends_on": days[-1]}).json()
    conflicts = [row for row in calendar.get("duty_conflicts", [])]
    print("duty_conflicts z kalendarza po publikacji:", json.dumps(conflicts, ensure_ascii=False)[:400])
