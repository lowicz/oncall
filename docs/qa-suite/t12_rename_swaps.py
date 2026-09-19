"""TC-H: what a rename does to the swap flow."""
from datetime import date, timedelta
from client import Api, check, FINDINGS, ADMIN_PASSWORD

TODAY = date.today()
admin = Api("admin", ADMIN_PASSWORD); koord = Api("koord"); marek = Api("marek")
team = {m["display_name"]: m for m in koord.get("/api/v1/team").json()}
pub = koord.get("/api/v1/schedules/published").json()

duties = [a for a in pub["assignments"]
          if a["assignee_name"] == "Marek Nowak"
          and a["role"] in ("primary", "secondary")
          and date.fromisoformat(a["service_date"]) > TODAY + timedelta(days=2)]
slot = duties[0]
sd, role = slot["service_date"], slot["role"]
print("slot before rename:", slot)

opts = marek.get(f"/api/v1/swaps/options?service_date={sd}&role={role}")
print("options BEFORE rename:", opts.status_code, len(opts.json()) if opts.status_code == 200 else opts.text[:100])
rid = opts.json()[0]["member_id"]
imp = marek.get(f"/api/v1/swaps/impact?service_date={sd}&role={role}&replacement_member_id={rid}")
print("impact  BEFORE rename:", imp.status_code)
check("H1.0", imp.status_code == 200, "impact works before rename", imp.text[:150])

uid = [u for u in admin.get("/api/v1/admin/users").json() if u["username"] == "marek"][0]["id"]
r = admin.patch(f"/api/v1/admin/users/{uid}", json={"last_name": "Nowak-Testowy"})
print("rename ->", r.status_code)

pub2 = koord.get("/api/v1/schedules/published").json()
still = [a for a in pub2["assignments"] if a["service_date"] == sd and a["role"] == role][0]
print("slot after rename (stored label):", still)
check("H1.1", still["assignee_name"] == "Marek Nowak-Testowy",
      f"published slot follows the rename (shows '{still['assignee_name']}')")

opts2 = marek.get(f"/api/v1/swaps/options?service_date={sd}&role={role}")
print("options AFTER rename:", opts2.status_code, opts2.text[:160])
check("H1.2", opts2.status_code == 200 and len(opts2.json()) > 0,
      "replacement options still available after rename", opts2.text[:150])

imp2 = marek.get(f"/api/v1/swaps/impact?service_date={sd}&role={role}&replacement_member_id={rid}")
print("impact  AFTER rename:", imp2.status_code, imp2.text[:200])
check("H1.3", imp2.status_code == 200,
      "swap impact preview still works after rename", imp2.text[:200])

cr = marek.post("/api/v1/swaps", json={"schedule_id": pub2["id"], "service_date": sd,
                                       "role": role, "replacement_member_id": rid})
print("create  AFTER rename:", cr.status_code, cr.text[:200])
check("H1.4", cr.status_code == 201, "swap can still be created after rename", cr.text[:200])
if cr.status_code == 201:
    marek.post(f"/api/v1/swaps/{cr.json()['id']}/cancel", json={"reason": "QA"})

# Does the double-booking guard still hold when the opposite-role holder was renamed?
opp = "secondary" if role == "primary" else "primary"
opp_name = [a["assignee_name"] for a in pub2["assignments"]
            if a["service_date"] == sd and a["role"] == opp][0]
opp_id = team.get(opp_name, {}).get("id")
print(f"opposite role {opp} that day: {opp_name}")
if opp_id:
    names = [o["display_name"] for o in opts2.json()] if opts2.status_code == 200 else []
    check("H1.5", opp_name not in names,
          f"person holding the opposite role is still excluded ({opp_name})")

admin.patch(f"/api/v1/admin/users/{uid}", json={"last_name": "Nowak"})
print()
for f in FINDINGS: print("  ", f)
