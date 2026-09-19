"""QA6: ile dyzurow w opublikowanym grafiku da sie faktycznie zamienic?"""
import sys
from collections import defaultdict
sys.path.insert(0, "docs/qa-suite-6")
from api import Api

coord = Api("adam.nowicki")
pub = coord.get("/api/v1/schedules/published").json()
sid = pub["id"]
LOGIN = {"Adam Nowicki": "adam.nowicki", "Beata Lis": "beata.lis", "Cezary Dudek": "cezary.dudek",
    "Dorota Pawlak": "dorota.pawlak", "Emil Zając": "emil.zajac", "Filip Górski": "filip.gorski",
    "Grażyna Wilk": "grazyna.wilk", "Hubert Baran": "hubert.baran",
    "Iwona Sadowska": "iwona.sadowska", "Jakub Polak": "jakub.polak"}
apis = {n: Api(l) for n, l in LOGIN.items()}

per_person = defaultdict(lambda: [0, 0])   # osoba -> [dyzury, zamienialne]
per_role = defaultdict(lambda: [0, 0])
rules = defaultdict(int)

for a in pub["assignments"]:
    day, role, who = a["service_date"], a["role"], a["assignee_name"]
    api = apis[who]
    per_person[who][0] += 1
    per_role[role][0] += 1
    opts = api.get("/api/v1/swaps/options",
                   params={"service_date": day, "role": role}).json()
    feasible = 0
    for o in opts:
        r = api.post("/api/v1/swaps", json={"schedule_id": sid, "service_date": day,
                     "role": role, "replacement_member_id": o["member_id"], "note": "QA6"})
        if r.status_code == 201:
            feasible += 1
            api.post(f"/api/v1/swaps/{r.json()['id']}/cancel", json={"reason": "QA6"})
        else:
            try:
                d = r.json()["detail"]
                if isinstance(d, dict):
                    for v in d.get("violations", []):
                        rules[v["rule"]] += 1
                else:
                    rules[str(d)[:50]] += 1
            except Exception:
                rules[r.text[:50]] += 1
    if feasible:
        per_person[who][1] += 1
        per_role[role][1] += 1

print(f"{'osoba':18} {'dyzurow':>8} {'zamienialnych':>14}")
for n in sorted(per_person):
    t, f = per_person[n]
    print(f"{n:18} {t:8} {f:14}  {'<-- ZERO' if f == 0 else ''}")
print()
print(f"{'rola':12} {'slotow':>8} {'zamienialnych':>14}")
for r in ("primary", "secondary", "late_shift"):
    t, f = per_role[r]
    print(f"{r:12} {t:8} {f:14}")
tot = sum(v[0] for v in per_person.values())
feas = sum(v[1] for v in per_person.values())
print(f"\nRAZEM: {feas}/{tot} slotow ({100*feas/tot:.0f}%) ma choc jednego mozliwego zastepce")
print("\npowody odrzucen (liczba naruszen):")
for k, v in sorted(rules.items(), key=lambda x: -x[1]):
    print(f"  {k:24} {v}")
