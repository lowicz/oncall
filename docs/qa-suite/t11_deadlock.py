"""TC-G: a pending swap whose schedule version moved on."""
from datetime import date, timedelta
from client import Api, check, FINDINGS, ADMIN_PASSWORD

TODAY = date.today()
koord = Api("koord")
team = {m["display_name"]: m for m in koord.get("/api/v1/team").json()}
LOGIN = {"Marek Nowak": "marek", "Anna Kowalska": "anna", "Aleksandra Wiśniewska": "ola",
         "Piotr Zieliński": "piotr", "Katarzyna Lewandowska": "kasia", "Tomasz Wójcik": "tomek",
         "Ewa Kamińska": "ewa", "Jakub Szymański": "jakub", "Magdalena Dąbrowska": "magda",
         "Rafał Woźniak": "rafal"}

pub = koord.get("/api/v1/schedules/published").json()
sid = pub["id"]
slot = [a for a in pub["assignments"]
        if a["role"] == "secondary"
        and TODAY + timedelta(days=12) < date.fromisoformat(a["service_date"]) < TODAY + timedelta(days=18)][0]
sd = slot["service_date"]
print("slot:", slot)
owner = Api(LOGIN[slot["assignee_name"]])
opts = owner.get(f"/api/v1/swaps/options?service_date={sd}&role=secondary").json()
repl = opts[0]
r = owner.post("/api/v1/swaps", json={"schedule_id": sid, "service_date": sd,
                                      "role": "secondary", "replacement_member_id": repl["member_id"]})
check("G1.1", r.status_code == 201, "swap created", r.text[:200])
swap_id = r.json()["id"]
r = Api(LOGIN[repl["display_name"]]).post(f"/api/v1/swaps/{swap_id}/accept")
check("G1.2", r.status_code == 200, "replacement accepted -> pending_coordinator", r.text[:150])

# Meanwhile a coordinator changes an unrelated day; the schedule version moves.
other = [a for a in pub["assignments"]
         if a["role"] == "primary"
         and TODAY + timedelta(days=19) < date.fromisoformat(a["service_date"]) < TODAY + timedelta(days=25)][0]
osd = other["service_date"]
osec = [a for a in pub["assignments"] if a["service_date"] == osd and a["role"] == "secondary"][0]
cand = [n for n in team
        if n not in (other["assignee_name"], osec["assignee_name"], "Ewa Kamińska")][0]
cur = koord.get("/api/v1/schedules/published").json()
r = koord.post("/api/v1/calendar/override", json={
    "schedule_id": sid, "expected_version": cur["version"], "service_date": osd,
    "role": "primary", "replacement_member_id": team[cand]["id"]})
check("G1.3", r.status_code == 200, f"unrelated override on {osd} applied", r.text[:200])

# The pending swap now carries a stale schedule version.
r = koord.post(f"/api/v1/swaps/{swap_id}/approve")
print("  approve after unrelated override ->", r.status_code, r.text[:160])
check("G1.4", r.status_code == 200,
      "an approved swap is not blocked by an unrelated change elsewhere in the schedule",
      str(r.status_code))

if r.status_code != 200:
    state = [s for s in koord.get("/api/v1/swaps").json() if s["id"] == swap_id][0]
    print("  swap state:", state["status"])
    r2 = owner.post("/api/v1/swaps", json={"schedule_id": sid, "service_date": sd,
                                           "role": "secondary",
                                           "replacement_member_id": repl["member_id"]})
    print("  create a fresh swap for the same slot ->", r2.status_code, r2.text[:160])
    check("G1.5", r2.status_code == 201,
          "the slot can be swapped again after the stale request failed", str(r2.status_code))
    check("G1.6", state["status"] not in ("pending_coordinator", "pending_replacement"),
          f"the unapprovable request does not stay pending forever (status={state['status']})")
    # cleanup
    owner.post(f"/api/v1/swaps/{swap_id}/cancel", json={"reason": "QA cleanup"})

print()
for f in FINDINGS: print("  ", f)
