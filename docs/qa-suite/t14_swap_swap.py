"""TC-G2: two swaps in flight at once, no coordinator override involved."""
from datetime import date, timedelta
from client import Api, check, FINDINGS

TODAY = date.today()
koord = Api("koord")
LOGIN = {"Marek Nowak": "marek", "Anna Kowalska": "anna", "Aleksandra Wiśniewska": "ola",
         "Piotr Zieliński": "piotr", "Katarzyna Lewandowska": "kasia", "Tomasz Wójcik": "tomek",
         "Ewa Kamińska": "ewa", "Jakub Szymański": "jakub", "Magdalena Dąbrowska": "magda",
         "Rafał Woźniak": "rafal"}
pub = koord.get("/api/v1/schedules/published").json()
sid = pub["id"]

def pick(lo, hi, used_days):
    for a in pub["assignments"]:
        d = date.fromisoformat(a["service_date"])
        if a["role"] == "primary" and lo < d < hi and a["service_date"] not in used_days \
           and a["assignee_name"] in LOGIN:
            return a
    return None

a1 = pick(TODAY + timedelta(days=2), TODAY + timedelta(days=10), set())
a2 = pick(TODAY + timedelta(days=11), TODAY + timedelta(days=20), {a1["service_date"]})
print("swap A on", a1["service_date"], a1["assignee_name"])
print("swap B on", a2["service_date"], a2["assignee_name"])

def make(a):
    owner = Api(LOGIN[a["assignee_name"]])
    opts = owner.get(f"/api/v1/swaps/options?service_date={a['service_date']}&role=primary").json()
    r = owner.post("/api/v1/swaps", json={"schedule_id": sid, "service_date": a["service_date"],
                                          "role": "primary",
                                          "replacement_member_id": opts[0]["member_id"]})
    assert r.status_code == 201, r.text
    swap = r.json()
    acc = Api(LOGIN[opts[0]["display_name"]]).post(f"/api/v1/swaps/{swap['id']}/accept")
    assert acc.status_code == 200, acc.text
    return swap["id"], owner, opts[0]

s1, o1, r1 = make(a1)
s2, o2, r2 = make(a2)
print("both swaps are pending_coordinator")

ap1 = koord.post(f"/api/v1/swaps/{s1}/approve")
print("approve A ->", ap1.status_code)
check("G2.1", ap1.status_code == 200, "first swap approved", ap1.text[:150])

ap2 = koord.post(f"/api/v1/swaps/{s2}/approve")
print("approve B ->", ap2.status_code, ap2.text[:150])
check("G2.2", ap2.status_code == 200,
      "second swap on a DIFFERENT day is still approvable after the first was approved",
      str(ap2.status_code))

if ap2.status_code != 200:
    retry = o2.post("/api/v1/swaps", json={"schedule_id": sid, "service_date": a2["service_date"],
                                           "role": "primary",
                                           "replacement_member_id": r2["member_id"]})
    print("re-request the same slot ->", retry.status_code, retry.text[:150])
    check("G2.3", retry.status_code == 201,
          "the blocked slot can be requested again", str(retry.status_code))
    state = [s for s in koord.get("/api/v1/swaps").json() if s["id"] == s2][0]
    check("G2.4", state["status"] != "pending_coordinator",
          f"the blocked request does not stay pending (status={state['status']})")

print()
for f in FINDINGS: print("  ", f)
