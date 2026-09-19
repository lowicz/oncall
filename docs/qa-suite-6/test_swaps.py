"""QA6: pelny cykl zyciowy zamiany jednodniowej."""
import sys, json
sys.path.insert(0, "docs/qa-suite-6")
from api import Api

coord = Api("adam.nowicki")
pub = coord.get("/api/v1/schedules/published").json()
sid, ver = pub["id"], pub["version"]
team = {m["display_name"]: m["id"] for m in coord.get("/api/v1/team").json()}

iwona = Api("iwona.sadowska")   # SECONDARY 2026-09-23/24/25
print("=== opcje zastepstwa dla Iwony 2026-09-24 secondary ===")
r = iwona.get("/api/v1/swaps/options", params={"service_date": "2026-09-24", "role": "secondary"})
print(r.status_code)
opts = r.json()
for o in opts:
    print("  ", json.dumps(o, ensure_ascii=False))

if not opts:
    print("BRAK OPCJI - nie da sie kontynuowac")
    sys.exit(1)

pick = opts[0]
print("\n=== podglad wplywu ===")
r = iwona.get("/api/v1/swaps/impact", params={
    "service_date": "2026-09-24", "role": "secondary",
    "replacement_member_id": pick["member_id"]})
print(r.status_code, json.dumps(r.json(), ensure_ascii=False)[:600])

print("\n=== zlozenie wniosku ===")
r = iwona.post("/api/v1/swaps", json={
    "schedule_id": sid, "service_date": "2026-09-24", "role": "secondary",
    "replacement_member_id": pick["member_id"],
    "note": "Wizyta lekarska"})
print(r.status_code, r.text[:300])
swap = r.json()
swap_id = swap["id"]

# kto jest zastepca
repl_name = pick["display_name"]
login = {v: k for k, v in {
    "Adam Nowicki": "adam.nowicki", "Beata Lis": "beata.lis", "Cezary Dudek": "cezary.dudek",
    "Dorota Pawlak": "dorota.pawlak", "Emil Zając": "emil.zajac", "Filip Górski": "filip.gorski",
    "Grażyna Wilk": "grazyna.wilk", "Hubert Baran": "hubert.baran",
    "Iwona Sadowska": "iwona.sadowska", "Jakub Polak": "jakub.polak"}.items()}
repl_login = {"Adam Nowicki": "adam.nowicki", "Beata Lis": "beata.lis", "Cezary Dudek": "cezary.dudek",
    "Dorota Pawlak": "dorota.pawlak", "Emil Zając": "emil.zajac", "Filip Górski": "filip.gorski",
    "Grażyna Wilk": "grazyna.wilk", "Hubert Baran": "hubert.baran",
    "Iwona Sadowska": "iwona.sadowska", "Jakub Polak": "jakub.polak"}[repl_name]
print("zastepca:", repl_name, "/", repl_login)
repl = Api(repl_login)

print("\n=== proby nieuprawnione ===")
obcy = Api("cezary.dudek") if repl_login != "cezary.dudek" else Api("emil.zajac")
print("  osoba trzecia akceptuje ->", obcy.post(f"/api/v1/swaps/{swap_id}/accept").status_code)
print("  autor akceptuje wlasny  ->", iwona.post(f"/api/v1/swaps/{swap_id}/accept").status_code)
print("  koordynator zatwierdza przed akceptacja ->",
      coord.post(f"/api/v1/swaps/{swap_id}/approve").status_code)

print("\n=== zastepca akceptuje ===")
r = repl.post(f"/api/v1/swaps/{swap_id}/accept")
print(r.status_code, r.text[:250])

print("\n=== koordynator zatwierdza ===")
r = coord.post(f"/api/v1/swaps/{swap_id}/approve")
print(r.status_code, r.text[:300])

print("\n=== ponowne zatwierdzenie (podwojne klikniecie) ===")
r = coord.post(f"/api/v1/swaps/{swap_id}/approve")
print(r.status_code, r.text[:200])

print("\n=== stan slotu po zamianie ===")
after = coord.get("/api/v1/schedules/published").json()
for a in after["assignments"]:
    if a["service_date"] == "2026-09-24":
        print("  ", a)
print("  wersja grafiku:", after["version"], "(przed:", ver, ")")
