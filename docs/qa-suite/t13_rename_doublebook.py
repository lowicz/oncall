"""TC-H2: can a rename let the same person hold both on-call roles the same day?"""
from datetime import date, timedelta
from client import Api, check, FINDINGS, ADMIN_PASSWORD

TODAY = date.today()
admin = Api("admin", ADMIN_PASSWORD); koord = Api("koord")
LOGIN = {"Marek Nowak": "marek", "Anna Kowalska": "anna", "Aleksandra Wiśniewska": "ola",
         "Piotr Zieliński": "piotr", "Katarzyna Lewandowska": "kasia", "Tomasz Wójcik": "tomek",
         "Ewa Kamińska": "ewa", "Jakub Szymański": "jakub", "Magdalena Dąbrowska": "magda",
         "Rafał Woźniak": "rafal"}
team = {m["display_name"]: m for m in koord.get("/api/v1/team").json()}
users = {u["username"]: u for u in admin.get("/api/v1/admin/users").json()}
pub = koord.get("/api/v1/schedules/published").json()

# A day where both on-call roles are held by people we can log in as.
day = None
for a in pub["assignments"]:
    if a["role"] != "primary":
        continue
    d = date.fromisoformat(a["service_date"])
    if not (TODAY + timedelta(days=3) < d < TODAY + timedelta(days=20)):
        continue
    sec = [x for x in pub["assignments"]
           if x["service_date"] == a["service_date"] and x["role"] == "secondary"][0]
    if a["assignee_name"] in LOGIN and sec["assignee_name"] in LOGIN:
        day, primary, secondary = a["service_date"], a["assignee_name"], sec["assignee_name"]
        break
print(f"{day}: primary={primary} secondary={secondary}")

# Rename the SECONDARY holder. The requester is the primary holder.
sec_login = LOGIN[secondary]
uid = users[sec_login]["id"]
r = admin.patch(f"/api/v1/admin/users/{uid}", json={"last_name": "Zmieniony"})
print("rename secondary holder ->", r.status_code)
new_name = admin.get("/api/v1/admin/users").json()
new_name = [u for u in new_name if u["username"] == sec_login][0]["display_name"]
new_id = [m for m in koord.get("/api/v1/team").json() if m["display_name"] == new_name][0]["id"]
print("secondary holder is now:", new_name)

requester = Api(LOGIN[primary])
opts = requester.get(f"/api/v1/swaps/options?service_date={day}&role=primary")
names = [o["display_name"] for o in opts.json()] if opts.status_code == 200 else []
print("options:", names)
check("H2.1", new_name not in names,
      f"the renamed secondary holder must NOT be offered as a primary replacement "
      f"({new_name} in options: {new_name in names})")

r = requester.post("/api/v1/swaps", json={"schedule_id": pub["id"], "service_date": day,
                                          "role": "primary", "replacement_member_id": new_id})
print("create swap with the same-day secondary holder ->", r.status_code, r.text[:180])
check("H2.2", r.status_code == 422,
      "creating a swap that double-books one person is rejected", str(r.status_code))

if r.status_code == 201:
    sid = r.json()["id"]
    a = Api(sec_login).post(f"/api/v1/swaps/{sid}/accept")
    print("  accept ->", a.status_code)
    ap = koord.post(f"/api/v1/swaps/{sid}/approve")
    print("  approve ->", ap.status_code, ap.text[:180])
    check("H2.3", ap.status_code != 200,
          "approval that double-books one person is rejected", str(ap.status_code))
    if ap.status_code == 200:
        after = koord.get("/api/v1/schedules/published").json()
        cells = [x for x in after["assignments"] if x["service_date"] == day
                 and x["role"] in ("primary", "secondary")]
        print("  RESULT:", cells)
        check("H2.4", cells[0]["assignee_name"] != cells[1]["assignee_name"],
              f"primary and secondary are still different people on {day}")
    else:
        Api(LOGIN[primary]).post(f"/api/v1/swaps/{sid}/cancel", json={"reason": "QA"})

admin.patch(f"/api/v1/admin/users/{uid}", json={"last_name": secondary.split(" ", 1)[1]})
print()
for f in FINDINGS: print("  ", f)
