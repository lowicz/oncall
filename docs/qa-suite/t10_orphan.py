"""TC-F6: ending rotation membership while future duties are still assigned."""
from datetime import date, timedelta
from client import Api, check, FINDINGS, ADMIN_PASSWORD

TODAY = date.today()
admin = Api("admin", ADMIN_PASSWORD); koord = Api("koord")
team = {m["display_name"]: m for m in koord.get("/api/v1/team").json()}
pub = koord.get("/api/v1/schedules/published").json()

victim_name = "Tomasz Wójcik"
member = team[victim_name]
cut = TODAY + timedelta(days=3)
future = [a for a in pub["assignments"]
          if a["assignee_name"] == victim_name and date.fromisoformat(a["service_date"]) > cut]
print(f"{victim_name} has {len(future)} duties after {cut}; first: {future[0] if future else '-'}")

# Bound every eligibility period first, exactly as an administrator would have to.
for e in member["eligibility"]:
    r = admin.patch(f"/api/v1/admin/eligibility/{e['id']}", json={"ends_on": str(cut)})
    print("  eligibility", e["role"], "->", r.status_code)
r = admin.patch(f"/api/v1/admin/team-members/{member['id']}", json={"active_until": str(cut)})
print("  team-member active_until ->", r.status_code, r.text[:200])
check("F6.1", r.status_code >= 400,
      f"ending rotation membership is refused while {len(future)} future duties remain",
      str(r.status_code))

if r.status_code == 200:
    after = koord.get("/api/v1/schedules/published").json()
    still = [a for a in after["assignments"]
             if a["assignee_name"] == victim_name and date.fromisoformat(a["service_date"]) > cut]
    print(f"  duties still assigned to the removed member: {len(still)}")
    cal = koord.get(f"/api/v1/calendar?starts_on={cut + timedelta(days=1)}"
                    f"&ends_on={cut + timedelta(days=20)}").json()
    rows = [m["display_name"] for m in cal["members"]]
    orphan = [a for a in cal["assignments"] if a["assignee_name"] not in rows]
    check("F6.2", not orphan,
          f"no duty in the matrix belongs to a person with no row ({len(orphan)} orphaned cells)")
    if orphan:
        print("  orphan sample:", orphan[:3])
    fair = koord.get("/api/v1/fairness").json()
    names = [m["display_name"] for m in fair["members"]]
    check("F6.3", victim_name in names,
          f"the removed member is still in the fairness report for the served window")
    opts = Api("tomek").get(f"/api/v1/swaps/options?service_date={still[0]['service_date']}"
                            f"&role={still[0]['role']}") if still else None
    if opts is not None:
        print("  swap options for the removed member:", opts.status_code, opts.text[:120])

# restore
admin.patch(f"/api/v1/admin/team-members/{member['id']}", json={"active_until": None})
for e in member["eligibility"]:
    admin.patch(f"/api/v1/admin/eligibility/{e['id']}", json={"ends_on": None})
print()
for f in FINDINGS: print("  ", f)
