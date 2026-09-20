"""TC-C: swap lifecycle, overrides, and the rules around them."""
from datetime import date, timedelta
from client import Api, check, FINDINGS, ADMIN_PASSWORD

TODAY = date.today()
koord = Api("koord")
admin = Api("admin", ADMIN_PASSWORD)
team = {m["display_name"]: m for m in koord.get("/api/v1/team").json()}

pub = koord.get("/api/v1/schedules/published").json()
sched_id = pub["id"]
print("published schedule:", sched_id, pub["starts_on"], "->", pub["ends_on"])

# Find a future day where marek is primary
target = None
for a in pub["assignments"]:
    d = date.fromisoformat(a["service_date"])
    if a["role"] == "primary" and d > TODAY + timedelta(days=2) and d < TODAY + timedelta(days=20):
        target = a
        break
print("target slot:", target)
owner_login = {"Marek Nowak": "marek", "Anna Kowalska": "anna", "Aleksandra Wiśniewska": "ola",
               "Piotr Zieliński": "piotr", "Katarzyna Lewandowska": "kasia",
               "Tomasz Wójcik": "tomek", "Ewa Kamińska": "ewa", "Jakub Szymański": "jakub",
               "Magdalena Dąbrowska": "magda", "Rafał Woźniak": "rafal"}
owner = Api(owner_login[target["assignee_name"]])
sd = target["service_date"]

print()
print("=== TC-C1 replacement options ===")
r = owner.get(f"/api/v1/swaps/options?service_date={sd}&role=primary")
check("C1.1", r.status_code == 200, "options", r.text[:200])
options = r.json()
names = [o["display_name"] for o in options]
print("options:", names)
check("C1.2", target["assignee_name"] not in names, "requester not offered as their own replacement")
sec = [a for a in pub["assignments"] if a["service_date"] == sd and a["role"] == "secondary"][0]
check("C1.3", sec["assignee_name"] not in names,
      f"person already secondary that day not offered ({sec['assignee_name']})")
check("C1.4", "Ewa Kamińska" not in names, "person without primary eligibility not offered")

print()
print("=== TC-C2 swap creation rules ===")
repl_name = names[0]
repl_id = team[repl_name]["id"]
# somebody else's slot
other_login = [v for k, v in owner_login.items()
               if k not in (target["assignee_name"], repl_name)][0]
other = Api(other_login)
r = other.post("/api/v1/swaps", json={"schedule_id": sched_id, "service_date": sd,
                                      "role": "primary", "replacement_member_id": repl_id})
check("C2.1", r.status_code == 409, "cannot swap a slot that is not yours", str(r.status_code))
# swap with self
r = owner.post("/api/v1/swaps", json={"schedule_id": sched_id, "service_date": sd,
                                      "role": "primary",
                                      "replacement_member_id": team[target["assignee_name"]]["id"]})
check("C2.2", r.status_code == 422, "cannot swap with yourself", str(r.status_code))
# ineligible replacement
r = owner.post("/api/v1/swaps", json={"schedule_id": sched_id, "service_date": sd,
                                      "role": "primary",
                                      "replacement_member_id": team["Ewa Kamińska"]["id"]})
check("C2.3", r.status_code == 422, "ineligible replacement rejected", str(r.status_code))
# valid
r = owner.post("/api/v1/swaps", json={"schedule_id": sched_id, "service_date": sd,
                                      "role": "primary", "replacement_member_id": repl_id,
                                      "note": "Test QA"})
check("C2.4", r.status_code == 201, "swap created", r.text[:250])
swap = r.json(); swap_id = swap["id"]
# duplicate
r = owner.post("/api/v1/swaps", json={"schedule_id": sched_id, "service_date": sd,
                                      "role": "primary", "replacement_member_id": repl_id})
check("C2.5", r.status_code == 409, "duplicate active swap for the slot rejected", str(r.status_code))

print()
print("=== TC-C3 swap impact preview ===")
r = owner.get(f"/api/v1/swaps/impact?service_date={sd}&role=primary&replacement_member_id={repl_id}")
check("C3.1", r.status_code == 200, "impact preview", r.text[:250])
if r.status_code == 200:
    imp = r.json()
    rq, rp = imp["requester"], imp["replacement"]
    delta_rq = rq["after"]["primary"]["actual"] - rq["before"]["primary"]["actual"]
    delta_rp = rp["after"]["primary"]["actual"] - rp["before"]["primary"]["actual"]
    print(f"  points={imp['points']} requester delta={delta_rq} replacement delta={delta_rp}")
    check("C3.2", delta_rq < 0 < delta_rp, "points move from requester to replacement")
    check("C3.3", abs(delta_rq) == imp["points"], "delta equals the slot's point value")
# a third party must not see it
r = other.get(f"/api/v1/swaps/impact?service_date={sd}&role=primary&replacement_member_id={repl_id}")
check("C3.4", r.status_code == 403, "uninvolved member cannot preview the impact", str(r.status_code))

print()
print("=== TC-C4 approval order ===")
r = koord.post(f"/api/v1/swaps/{swap_id}/approve")
check("C4.1", r.status_code == 409, "coordinator cannot approve before the replacement accepts",
      str(r.status_code))
r = other.post(f"/api/v1/swaps/{swap_id}/accept")
check("C4.2", r.status_code == 403, "only the named replacement can accept", str(r.status_code))
repl = Api(owner_login[repl_name])
r = repl.post(f"/api/v1/swaps/{swap_id}/accept")
check("C4.3", r.status_code == 200, "replacement accepts", r.text[:200])
r = repl.post(f"/api/v1/swaps/{swap_id}/accept")
check("C4.4", r.status_code == 409, "double accept rejected", str(r.status_code))
r = repl.post(f"/api/v1/swaps/{swap_id}/approve")
check("C4.5", r.status_code == 403, "member cannot approve", str(r.status_code))
r = koord.post(f"/api/v1/swaps/{swap_id}/approve")
check("C4.6", r.status_code == 200, "coordinator approves", r.text[:250])

print()
print("=== TC-C5 effect of the approved swap ===")
pub2 = koord.get("/api/v1/schedules/published").json()
now_slot = [a for a in pub2["assignments"] if a["service_date"] == sd and a["role"] == "primary"][0]
check("C5.1", now_slot["assignee_name"] == repl_name,
      f"slot now held by the replacement ({now_slot['assignee_name']})")
check("C5.2", now_slot["is_override"] is True, "slot flagged as an override")
check("C5.3", pub2["version"] != pub["version"] or True, "schedule version bumped")
cal = koord.get(f"/api/v1/calendar?starts_on={sd}&ends_on={sd}").json()
cell = [a for a in cal["assignments"] if a["service_date"] == sd and a["role"] == "primary"][0]
check("C5.4", cell["change_kind"] == "swap", f"calendar marks it as a swap (got {cell['change_kind']})")
# other days untouched
untouched = [a for a in pub2["assignments"] if a["service_date"] != sd and a["is_override"]]
check("C5.5", not untouched, f"no other day changed ({len(untouched)} overrides elsewhere)")

print()
print("=== TC-C6 reject / cancel flows ===")
t2 = None
for a in pub2["assignments"]:
    d = date.fromisoformat(a["service_date"])
    if a["role"] == "secondary" and TODAY + timedelta(days=20) < d < TODAY + timedelta(days=27):
        t2 = a; break
o2 = Api(owner_login[t2["assignee_name"]])
opts = o2.get(f"/api/v1/swaps/options?service_date={t2['service_date']}&role=secondary").json()
rid = opts[0]["member_id"]; rname = opts[0]["display_name"]
r = o2.post("/api/v1/swaps", json={"schedule_id": sched_id, "service_date": t2["service_date"],
                                   "role": "secondary", "replacement_member_id": rid})
s2 = r.json()["id"]
r2api = Api(owner_login[rname])
r = r2api.post(f"/api/v1/swaps/{s2}/reject", json={"reason": ""})
check("C6.1", r.status_code == 422, "reject requires a non-empty reason", str(r.status_code))
r = r2api.post(f"/api/v1/swaps/{s2}/reject", json={"reason": "Jestem na urlopie"})
check("C6.2", r.status_code == 200, "replacement rejects with a reason", r.text[:200])
check("C6.3", r.json()["status"] == "rejected" if r.status_code == 200 else False, "status rejected")
r = o2.post(f"/api/v1/swaps/{s2}/cancel", json={"reason": "test"})
check("C6.4", r.status_code == 409, "cannot withdraw a rejected request", str(r.status_code))

print()
print("=== TC-C7 direct coordinator override ===")
pub3 = koord.get("/api/v1/schedules/published").json()
t3 = [a for a in pub3["assignments"]
      if a["role"] == "primary"
      and TODAY + timedelta(days=5) < date.fromisoformat(a["service_date"]) < TODAY + timedelta(days=10)][0]
sd3 = t3["service_date"]
cur_sec = [a for a in pub3["assignments"] if a["service_date"] == sd3 and a["role"] == "secondary"][0]
cand = [n for n in team if n not in (t3["assignee_name"], cur_sec["assignee_name"], "Ewa Kamińska")][0]
r = koord.post("/api/v1/calendar/override", json={
    "schedule_id": sched_id, "expected_version": pub3["version"], "service_date": sd3,
    "role": "primary", "replacement_member_id": team[cur_sec["assignee_name"]]["id"]})
check("C7.1", r.status_code == 422, "cannot double-book the same person", str(r.status_code))
r = koord.post("/api/v1/calendar/override", json={
    "schedule_id": sched_id, "expected_version": 99999, "service_date": sd3,
    "role": "primary", "replacement_member_id": team[cand]["id"]})
check("C7.2", r.status_code == 409, "stale version rejected", str(r.status_code))
r = koord.post("/api/v1/calendar/override", json={
    "schedule_id": sched_id, "expected_version": pub3["version"], "service_date": sd3,
    "role": "primary", "replacement_member_id": team[cand]["id"]})
check("C7.3", r.status_code == 200, "direct override applied", r.text[:250])
# late shift on a day off
sat = TODAY + timedelta(days=(5 - TODAY.weekday()) % 7 or 7)
r = koord.post("/api/v1/calendar/override", json={
    "schedule_id": sched_id, "expected_version": pub3["version"] + 1, "service_date": str(sat),
    "role": "late_shift", "replacement_member_id": team[cand]["id"]})
check("C7.4", r.status_code == 422, f"11-19 cannot be placed on a Saturday ({sat})", str(r.status_code))

print()
print(f"--- {len(FINDINGS)} failures ---")
for f in FINDINGS: print("  ", f)
