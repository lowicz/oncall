"""QA6: czy zamiana slotu SECONDARY jest w ogole wykonalna przy kotwicy 'secondary'?"""
import sys, json
sys.path.insert(0, "docs/qa-suite-6")
from api import Api

coord = Api("adam.nowicki")
pol = coord.get("/api/v1/scheduling/policy").json()
print("kotwica 11-19:", pol["late_shift_anchor"], "| tryb:", pol["rotation_mode"])
pub = coord.get("/api/v1/schedules/published").json()
sid = pub["id"]
slots = {(a["service_date"], a["role"]): a["assignee_name"] for a in pub["assignments"]}

LOGIN = {"Adam Nowicki": "adam.nowicki", "Beata Lis": "beata.lis", "Cezary Dudek": "cezary.dudek",
    "Dorota Pawlak": "dorota.pawlak", "Emil Zając": "emil.zajac", "Filip Górski": "filip.gorski",
    "Grażyna Wilk": "grazyna.wilk", "Hubert Baran": "hubert.baran",
    "Iwona Sadowska": "iwona.sadowska", "Jakub Polak": "jakub.polak"}

cases = [
    ("2026-09-24", "secondary"),   # dzien roboczy, kotwica aktywna
    ("2026-09-24", "primary"),     # dzien roboczy, rola niekotwiczaca
    ("2026-10-03", "secondary"),   # sobota, brak slotu 11-19
    ("2026-10-03", "primary"),
    ("2026-09-24", "late_shift"),  # sama zmiana 11-19
]

for day, role in cases:
    owner = slots.get((day, role))
    if owner is None:
        print(f"\n{day} {role}: brak slotu")
        continue
    api = Api(LOGIN[owner])
    opts = api.get("/api/v1/swaps/options", params={"service_date": day, "role": role}).json()
    print(f"\n{day} {role} (obecnie {owner}): {len(opts)} opcji oferowanych")
    ok = blocked = 0
    reasons = set()
    for o in opts:
        r = api.post("/api/v1/swaps", json={
            "schedule_id": sid, "service_date": day, "role": role,
            "replacement_member_id": o["member_id"], "note": "test QA6"})
        if r.status_code == 201:
            ok += 1
            # cofnij, zeby nie zasmiecac
            api.post(f"/api/v1/swaps/{r.json()['id']}/cancel", json={"reason": "test QA6"})
        else:
            blocked += 1
            try:
                d = r.json()["detail"]
                if isinstance(d, dict):
                    reasons.update(v["rule"] for v in d.get("violations", []))
                else:
                    reasons.add(str(d)[:80])
            except Exception:
                reasons.add(r.text[:80])
    print(f"   przyjete: {ok}   odrzucone: {blocked}   powody: {sorted(reasons)}")
