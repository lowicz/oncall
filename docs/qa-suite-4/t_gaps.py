"""Przypadki, które nie zmieściły się w pierwszym przebiegu rundy."""
import time
from datetime import date, timedelta

from qa import Client

coordinator = Client("ola.zielinska")
admin = Client("admin")


def run(starts_on: str, ends_on: str, client=coordinator) -> dict:
    queued = client.post("/api/v1/scheduling/runs",
                         json={"starts_on": starts_on, "ends_on": ends_on})
    if queued.status_code != 202:
        return {"error": f"{queued.status_code} {queued.text[:120]}"}
    run_id = queued.json()["id"]
    while True:
        state = client.get(f"/api/v1/scheduling/runs/{run_id}").json()
        if state["status"] in ("completed", "failed"):
            return state
        time.sleep(1)


print("== C7 usunięcie szkicu ==")
drafts = coordinator.get("/api/v1/scheduling/drafts").json()
victim = [d for d in drafts if d["starts_on"] == "2027-05-01"]
if victim:
    print("  usunięcie:", coordinator.delete(f"/api/v1/scheduling/{victim[0]['id']}").status_code)
    print("  po usunięciu GET:",
          coordinator.get(f"/api/v1/scheduling/{victim[0]['id']}").status_code)
else:
    print("  brak szkicu do usunięcia")

print("\n== D3 odrzucenie i wycofanie zamiany z powodem ==")
member = Client("julia.nowak")
options = member.get("/api/v1/swaps/options",
                     params={"service_date": "2026-09-30", "role": "primary"})
mine = [item for item in member.get("/api/v1/calendar",
        params={"starts_on": "2026-09-07", "ends_on": "2026-10-04"}).json()["assignments"]
        if item["assignee_name"] == "Julia Nowak" and item["role"] == "primary"]
print("  dyżury Julii:", [(m["service_date"], m["role"]) for m in mine][:4])
if mine:
    slot = mine[0]
    opts = member.get("/api/v1/swaps/options",
                      params={"service_date": slot["service_date"], "role": "primary"}).json()
    print("  kandydaci:", [o["display_name"] for o in opts][:4])
    payload = {"schedule_id": slot["schedule_id"], "service_date": slot["service_date"],
               "role": "primary", "replacement_member_id": opts[0]["member_id"]}
    created = member.post("/api/v1/swaps", json=payload)
    print("  utworzenie:", created.status_code, created.text[:120])
    swap_id = created.json()["id"]
    print("  wycofanie bez powodu:",
          member.post(f"/api/v1/swaps/{swap_id}/cancel", json={}).status_code)
    print("  wycofanie z powodem:",
          member.post(f"/api/v1/swaps/{swap_id}/cancel",
                      json={"reason": "Jednak zostaję"}).status_code)

    created = member.post("/api/v1/swaps", json=payload)
    swap_id = created.json()["id"]
    replacement = Client(next(u for u in (
        "anna.kowalska", "marek.wisniewski", "katarzyna.dabrowska", "magdalena.wozniak",
        "tomasz.szymanski", "piotr.lewandowski", "bartosz.mazur")
        if u.split(".")[0].capitalize() in opts[0]["display_name"]
        or opts[0]["display_name"].split()[0] == u.split(".")[0].capitalize()))
    rejected = replacement.post(f"/api/v1/swaps/{swap_id}/reject",
                                json={"reason": "Mam wtedy szkolenie"})
    print("  odrzucenie przez zastępcę:", rejected.status_code,
          rejected.json().get("status") if rejected.status_code == 200 else rejected.text[:120])

print("\n== B8 eligibility z datą końcową ==")
team = admin.get("/api/v1/team").json()
tomasz = [m for m in team if m["display_name"] == "Tomasz Szymański"][0]
created = admin.post(f"/api/v1/admin/team-members/{tomasz['id']}/eligibility",
                     json={"role": "late_shift", "starts_on": "2027-02-01",
                           "ends_on": "2027-02-28"})
print("  dodanie okresu 02-2027:", created.status_code, created.text[:160])
if created.status_code < 300:
    overlap = admin.post(f"/api/v1/admin/team-members/{tomasz['id']}/eligibility",
                         json={"role": "late_shift", "starts_on": "2027-02-15",
                               "ends_on": "2027-03-15"})
    print("  nakładający się okres:", overlap.status_code, overlap.text[:120])
    print("  usunięcie:", admin.delete(
        f"/api/v1/admin/eligibility/{created.json()['id']}").status_code)

print("\n== J3 usunięcie konta, które uruchomiło generator ==")
throwaway = admin.post("/api/v1/admin/users", json={
    "username": "tymczasowy.koord", "first_name": "Tymczasowy", "last_name": "Koordynator",
    "role": "coordinator", "personnel_number": "100999"})
print("  utworzenie konta:", throwaway.status_code)
if throwaway.status_code == 201:
    user_id = throwaway.json()["user"]["id"]
    activation = throwaway.json()["activation_url"]
    token = activation.rsplit("/", 1)[-1]
    import httpx
    from qa import BASE
    activated = httpx.post(f"{BASE}/api/v1/auth/activate",
                           json={"token": token, "password": "OncallQA-2026!"}, timeout=30)
    print("  aktywacja:", activated.status_code)
    temp = Client("tymczasowy.koord")
    state = run("2027-06-07", "2027-06-13", temp)
    print("  generowanie:", state.get("status"), state.get("error"))
    deleted = admin.delete(f"/api/v1/admin/users/{user_id}")
    print("  usunięcie konta:", deleted.status_code, deleted.text[:160])
    events = admin.get("/api/v1/admin/audit", params={"actor": "Tymczasowy"}).json()
    print("  ślad w audycie po usunięciu:", [(e["action"], e["actor_label"]) for e in events][:3])
