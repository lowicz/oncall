import sys, json
sys.path.insert(0, "docs/qa-suite-6")
from api import Api

viewer = Api("lucjan.widok")
member = Api("beata.lis")
coord = Api("adam.nowicki")

print("=== viewer: kanaly ICS ===")
r = viewer.get("/api/v1/calendar/feeds")
print("GET  /calendar/feeds ->", r.status_code, r.text[:120])
r = viewer.post("/api/v1/calendar/feeds", json={"label": "moj kanal"})
print("POST /calendar/feeds ->", r.status_code, r.text[:200])

print("\n=== viewer: kalendarz (czy widzi dostepnosci?) ===")
r = viewer.get("/api/v1/calendar", params={"starts_on": "2026-09-14", "ends_on": "2026-09-20"})
d = r.json()
print("klucze:", sorted(d.keys()))
print(json.dumps(d, ensure_ascii=False)[:900])

print("\n=== czlonek: ten sam kalendarz ===")
d2 = member.get("/api/v1/calendar", params={"starts_on": "2026-09-14", "ends_on": "2026-09-20"}).json()
print(json.dumps(d2, ensure_ascii=False)[:900])

print("\n=== czy w odpowiedzi viewera pada slowo 'urlop'/notatka? ===")
raw = json.dumps(d, ensure_ascii=False)
for probe in ("Urlop", "Wyjazd", "Wesele", "Szkolenie", "Remont", "unavailable", "prefer"):
    print(f"  {probe:14} w odpowiedzi viewera: {probe in raw}")

print("\n=== raport miesieczny (poprawny format) ===")
for who, api in (("koordynator", coord), ("czlonek", member), ("viewer", viewer)):
    r = api.get("/api/v1/reports/monthly.csv", params={"month": "2026-09"})
    print(f"  {who:12} -> {r.status_code} {r.text[:150]!r}")
