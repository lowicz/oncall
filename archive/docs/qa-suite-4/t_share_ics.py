"""Share links, limited viewer sessions and ICS feeds."""
import httpx

from qa import BASE, Client

admin = Client("admin")
created = admin.post(
    "/api/v1/admin/share-links",
    json={"label": "Audyt zewnętrzny", "starts_on": "2026-09-10", "ends_on": "2026-09-20",
          "expires_days": 7},
)
print("utworzenie linku:", created.status_code)
body = created.json()
token = body["url"].rsplit("/", 1)[-1]
print("odpowiedz:", {k: v for k, v in body.items() if k != "url"})

guest = httpx.Client(base_url=BASE, timeout=30)
exchange = guest.post("/api/v1/share/exchange", json={"token": token})
print("wymiana tokenu:", exchange.status_code)
print("ponowna wymiana tego samego tokenu:", guest.post("/api/v1/share/exchange", json={"token": token}).status_code)

published = guest.get("/api/v1/schedules/published")
print("grafik dla linku:", published.status_code)
data = published.json()
dates = sorted({item["service_date"] for item in data.get("assignments", [])})
print("dni widoczne:", dates[:2], "...", dates[-2:] if dates else "brak", "liczba:", len(dates))
for path in ("/api/v1/fairness", "/api/v1/team", "/api/v1/swaps", "/api/v1/admin/users",
             "/api/v1/calendar?starts_on=2026-09-01&ends_on=2026-09-30"):
    print(f"  link -> {path:60} {guest.get(path).status_code}")

feed = admin.post(f"/api/v1/admin/share-links/{body['id']}/calendar-feed")
print("kanal ICS dla linku:", feed.status_code, feed.text[:120] if feed.status_code >= 400 else "")

member = Client("anna.kowalska")
own = member.post("/api/v1/calendar/feeds", json={"label": "Mój telefon"})
print("kanal ICS czlonka:", own.status_code)
if own.status_code < 300:
    url = own.json()["url"]
    ics = httpx.get(url.replace("http://localhost:8080", BASE), timeout=30)
    print("pobranie ICS:", ics.status_code, "bajtow:", len(ics.text))
    names = {line for line in ics.text.splitlines() if line.startswith("SUMMARY")}
    print("przyklady:", list(names)[:4])
    foreign = [line for line in names if "Anna" not in line and "PRIMARY" not in line
               and "SECONDARY" not in line and "11" not in line]
    print("wpisy spoza wlasnych:", foreign[:3])

revoked = admin.delete(f"/api/v1/admin/share-links/{body['id']}")
print("uniewaznienie:", revoked.status_code)
print("po uniewaznieniu grafik:", guest.get("/api/v1/schedules/published").status_code)
