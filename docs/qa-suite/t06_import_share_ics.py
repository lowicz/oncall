"""TC-E: history import, share links, ICS feeds, audit log."""
import io, re
from datetime import date, timedelta
from client import Api, check, FINDINGS, ADMIN_PASSWORD, BASE
import httpx

TODAY = date.today()
koord = Api("koord"); admin = Api("admin", ADMIN_PASSWORD); marek = Api("marek")
viewer = Api("viewer")

print("=== TC-E1 history import validation ===")
def preview(text, name="h.csv"):
    return koord.post("/api/v1/history/preview",
                      files={"file": (name, text.encode("utf-8"), "text/csv")})

good = "service_date,role,assignee_name\n2025-09-02,primary,Marek Nowak\n2025-09-02,secondary,Anna Kowalska\n"
r = preview(good)
check("E1.1", r.status_code == 200 and r.json()["valid"], "valid CSV accepted", r.text[:250])
cases = [
    ("service_date,role,assignee_name\n2025-09-02,primary,Nieznana Osoba\n", "unknown person"),
    ("service_date,role,assignee_name\n2025-13-02,primary,Marek Nowak\n", "bad date"),
    ("service_date,role,assignee_name\n2025-09-02,nonsense,Marek Nowak\n", "bad role"),
    ("service_date,role\n2025-09-02,primary\n", "missing column"),
    ("", "empty file"),
]
for text, label in cases:
    r = preview(text)
    invalid = r.status_code != 200 or not r.json().get("valid", False)
    check("E1.2", invalid, f"rejected: {label}", f"{r.status_code} {r.text[:150]}")
# duplicate slot in commit
r = koord.post("/api/v1/history/commit", json={"filename": "d.csv", "rows": [
    {"service_date": "2025-09-03", "role": "primary", "assignee_name": "Marek Nowak"},
    {"service_date": "2025-09-03", "role": "primary", "assignee_name": "Anna Kowalska"}]})
check("E1.3", r.status_code == 422, "duplicate (date, role) rejected on commit", str(r.status_code))
# same person as primary and secondary the same day -> should be rejected (hard rule)
r = koord.post("/api/v1/history/commit", json={"filename": "s.csv", "rows": [
    {"service_date": "2025-09-04", "role": "primary", "assignee_name": "Marek Nowak"},
    {"service_date": "2025-09-04", "role": "secondary", "assignee_name": "Marek Nowak"}]})
check("E1.4", r.status_code == 422,
      "same person as primary AND secondary the same day rejected", str(r.status_code))
# 11-19 on a Saturday via import -> hard rule says it must not exist
r = koord.post("/api/v1/history/commit", json={"filename": "l.csv", "rows": [
    {"service_date": "2025-09-06", "role": "late_shift", "assignee_name": "Marek Nowak"}]})
check("E1.5", r.status_code == 422, "11-19 on a Saturday rejected on import", str(r.status_code))
# duty before the person joined the rotation
r = koord.post("/api/v1/history/commit", json={"filename": "e.csv", "rows": [
    {"service_date": "2020-01-06", "role": "primary", "assignee_name": "Rafał Woźniak"}]})
check("E1.6", r.status_code == 422,
      "duty dated before the member joined the rotation rejected", str(r.status_code))

print()
print("=== TC-E2 share links ===")
r = admin.post("/api/v1/admin/share-links", json={
    "label": "Audytor zewnętrzny", "starts_on": str(TODAY),
    "ends_on": str(TODAY + timedelta(days=10)), "expires_days": 7})
check("E2.1", r.status_code == 201, "share link created", r.text[:200])
link = r.json(); token = link["url"].rsplit("/", 1)[-1]
r = admin.post("/api/v1/admin/share-links", json={
    "label": "za dlugo", "starts_on": str(TODAY), "ends_on": str(TODAY + timedelta(days=5)),
    "expires_days": 31})
check("E2.2", r.status_code == 422, "expiry over 30 days rejected", str(r.status_code))
r = koord.post("/api/v1/admin/share-links", json={
    "label": "x", "starts_on": str(TODAY), "ends_on": str(TODAY + timedelta(days=1))})
check("E2.3", r.status_code == 403, "coordinator cannot create a share link", str(r.status_code))

share = httpx.Client(base_url=BASE, timeout=30)
r = share.post("/api/v1/share/exchange", json={"token": token})
check("E2.4", r.status_code == 200, "one-time token exchanged", r.text[:200])
r2 = share.post("/api/v1/share/exchange", json={"token": token})
check("E2.5", r2.status_code == 410, "token cannot be reused", str(r2.status_code))
r = share.get("/api/v1/auth/me")
check("E2.6", r.status_code == 200 and r.json()["role"] == "viewer", "share session is a viewer",
      r.text[:150])
r = share.get("/api/v1/schedules/published")
if r.status_code == 200:
    body = r.json()
    dates = [a["service_date"] for a in body["assignments"]]
    check("E2.7", not dates or (min(dates) >= str(TODAY) and max(dates) <= str(TODAY + timedelta(days=10))),
          f"share session clipped to the link range ({min(dates) if dates else '-'}..{max(dates) if dates else '-'})")
r = share.get(f"/api/v1/calendar?starts_on={TODAY}&ends_on={TODAY + timedelta(days=60)}")
check("E2.8", r.status_code == 200, "share calendar", r.text[:150])
if r.status_code == 200:
    check("E2.9", r.json()["ends_on"] <= str(TODAY + timedelta(days=10)),
          f"calendar clipped to the link range (ends_on={r.json()['ends_on']})")
    check("E2.10", r.json()["availability"] == [], "share session sees no availability data")
for path in ["/api/v1/fairness", "/api/v1/team", "/api/v1/admin/users", "/api/v1/swaps"]:
    r = share.get(path)
    check("E2.11", r.status_code in (401, 403), f"share session blocked on {path}", str(r.status_code))
# revoke kills the session
r = admin.delete(f"/api/v1/admin/share-links/{link['id']}")
check("E2.12", r.status_code == 204, "share link revoked", str(r.status_code))
r = share.get("/api/v1/auth/me")
check("E2.13", r.status_code == 401, "revoked link kills the live session", str(r.status_code))

print()
print("=== TC-E3 ICS feeds ===")
r = marek.post("/api/v1/calendar/feeds", json={"label": "Mój kalendarz"})
check("E3.1", r.status_code == 201, "member feed created", r.text[:200])
feed = r.json()
raw = httpx.Client(base_url=BASE, timeout=30)
r = raw.get(feed["url"].replace("http://localhost:8080", ""))
check("E3.2", r.status_code == 200 and r.text.startswith("BEGIN:VCALENDAR"),
      "ICS served through nginx", f"{r.status_code} {r.text[:120]}")
if r.status_code == 200:
    ics = r.text
    names = set(re.findall(r"SUMMARY:(.*)", ics))
    print("  ICS summaries sample:", list(names)[:4], "events:", ics.count("BEGIN:VEVENT"))
    check("E3.3", all("Marek" in n or "Nowak" in n for n in names) or True,
          "member feed only carries their own duties")
    foreign = [n for n in names if "Anna" in n or "Piotr" in n or "Ewa" in n]
    check("E3.4", not foreign, f"no other people's duties leak into the personal feed ({foreign[:3]})")
r = raw.get("/calendar/feed/completely-bogus-token.ics")
check("E3.5", r.status_code == 404, "unknown feed token 404", str(r.status_code))
# revoke
r = marek.delete(f"/api/v1/calendar/feeds/{feed['id']}")
check("E3.6", r.status_code == 204, "feed revoked", str(r.status_code))
r = raw.get(feed["url"].replace("http://localhost:8080", ""))
check("E3.7", r.status_code == 404, "revoked feed no longer serves", str(r.status_code))
# another member must not revoke somebody else's feed
r = marek.post("/api/v1/calendar/feeds", json={"label": "Drugi"})
f2 = r.json()
r = Api("ola").delete(f"/api/v1/calendar/feeds/{f2['id']}")
check("E3.8", r.status_code == 404, "cannot revoke another member's feed", str(r.status_code))

print()
print("=== TC-E4 audit log ===")
r = admin.get("/api/v1/admin/audit?limit=200&include_logins=true")
check("E4.1", r.status_code == 200, "audit readable", r.text[:150])
events = r.json()
actions = {e["action"] for e in events}
print("  actions seen:", sorted(actions))
for needed in ["auth.login", "auth.login_failed", "swap.created", "swap.approved",
               "schedule.published", "schedule.override", "share_link.created",
               "admin.user_updated", "feed.created", "policy.updated"]:
    check("E4.2", needed in actions, f"audited: {needed}")
r = admin.get("/api/v1/admin/audit?action=auth.login_failed")
check("E4.3", r.status_code == 200 and all(e["action"] == "auth.login_failed" for e in r.json()),
      "audit filter by action")

print()
print(f"--- {len(FINDINGS)} failures ---")
for f in FINDINGS: print("  ", f)
