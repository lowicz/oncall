"""QA6: ICS, linki udostepnien, raport miesieczny, audyt, wydarzenia kalendarza."""
import sys, json, re
sys.path.insert(0, "docs/qa-suite-6")
from api import Api
import httpx

admin = Api("admin", "Qwertyuiop1!")
coord = Api("adam.nowicki")
iwona = Api("iwona.sadowska")
raw = httpx.Client(base_url="http://localhost:8080", timeout=30)

print("=== ICS: kanal czlonka ===")
r = iwona.post("/api/v1/calendar/feeds", json={"label": "Kalendarz Iwony"})
print("utworzenie:", r.status_code, json.dumps(r.json(), ensure_ascii=False)[:220])
feed = r.json()
url = feed.get("url") or feed.get("feed_url")
if url:
    path = url.split("localhost:8080")[-1]
    ics = raw.get(path)
    print("pobranie:", ics.status_code, "bajtow:", len(ics.text))
    print("  Content-Type:", ics.headers.get("content-type"))
    names = set(re.findall(r"SUMMARY:(.*)", ics.text))
    print("  SUMMARY (unikalne):", list(names)[:6])
    print("  liczba VEVENT:", ics.text.count("BEGIN:VEVENT"))
    obce = [n for n in names if "Iwona" not in n and "iwona" not in n]
    print("  czy widac cudze dyzury?", "TAK - WYCIEK" if any(
        x in ics.text for x in ("Hubert", "Grażyna", "Cezary")) else "nie")
    fid = feed["id"]
    print("odwolanie:", iwona.delete(f"/api/v1/calendar/feeds/{fid}").status_code)
    print("po odwolaniu:", raw.get(path).status_code)

print("\n=== Linki udostepnien ===")
r = admin.post("/api/v1/admin/share-links", json={
    "label": "Audyt zewnetrzny", "starts_on": "2026-09-07", "ends_on": "2026-09-30",
    "expires_days": 7})
print("utworzenie:", r.status_code, json.dumps(r.json(), ensure_ascii=False)[:250])
link = r.json()
token = None
u = link.get("url") or ""
if "/share/" in u:
    token = u.rsplit("/share/", 1)[-1]
if token:
    c2 = httpx.Client(base_url="http://localhost:8080", timeout=30)
    r = c2.post("/api/v1/share/exchange", json={"token": token})
    print("wymiana tokenu:", r.status_code, r.text[:200])
    print("  ponowna wymiana (jednorazowy?):",
          httpx.Client(base_url="http://localhost:8080").post(
              "/api/v1/share/exchange", json={"token": token}).status_code)
    d = c2.get("/api/v1/schedules/published")
    print("  odczyt grafiku sesja share:", d.status_code)
    if d.status_code == 200:
        days = sorted({a["service_date"] for a in d.json()["assignments"]})
        print("  zakres widoczny:", days[0], "-", days[-1], f"({len(days)} dni)")
        print("  czy przyciety do zakresu linku (do 2026-09-30)?",
              "TAK" if days[-1] <= "2026-09-30" else f"NIE - widac {days[-1]}")
    print("  dostep do fairness:", c2.get("/api/v1/fairness").status_code)
    print("  dostep do audytu:", c2.get("/api/v1/admin/audit").status_code)
    print("  dostep do zamian:", c2.get("/api/v1/swaps").status_code)
    lid = link["id"]
    print("  odwolanie linku:", admin.delete(f"/api/v1/admin/share-links/{lid}").status_code)
    print("  sesja po odwolaniu:", c2.get("/api/v1/schedules/published").status_code)

print("\n=== Raport miesieczny ===")
r = coord.get("/api/v1/reports/monthly.csv", params={"month": "2026-09"})
lines = r.text.splitlines()
print("status:", r.status_code, "wierszy:", len(lines))
print("naglowek:", lines[0][:200])
for ln in lines[1:5]:
    print("  ", ln[:160])
r = coord.get("/api/v1/reports/monthly", params={"month": "2026-09"})
print("podglad JSON:", r.status_code, json.dumps(r.json(), ensure_ascii=False)[:250])

print("\n=== Audyt ===")
r = admin.get("/api/v1/admin/audit", params={"limit": 8})
ev = r.json()
print("status:", r.status_code, "zdarzen:", len(ev))
for e in ev[:8]:
    print(f"  {e['occurred_at'][:19]} {e['actor_label']:16} {e['action']:26} {e['summary'][:70]}")
