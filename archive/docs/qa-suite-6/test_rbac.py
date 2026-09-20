"""QA6: RBAC matrix. The backend, not the SPA, is the security boundary."""
import sys
sys.path.insert(0, "docs/qa-suite-6")
from api import Api
import httpx

ROLES = {
    "admin":       ("admin", "Qwertyuiop1!"),
    "coordinator": ("adam.nowicki", None),
    "member":      ("beata.lis", None),
    "viewer":      ("lucjan.widok", None),
}

sessions = {}
for label, (login, pwd) in ROLES.items():
    sessions[label] = Api(login, pwd) if pwd else Api(login)

anon = httpx.Client(base_url="http://localhost:8080", timeout=30)

coord = sessions["coordinator"]
members = {m["display_name"]: m["id"] for m in coord.get("/api/v1/team").json()}
pub = coord.get("/api/v1/schedules/published").json()

# (etykieta, metoda, sciezka, body, {rola: oczekiwany_kod})
CASES = [
    ("odczyt opublikowanego grafiku", "GET", "/api/v1/schedules/published", None,
     {"admin": 200, "coordinator": 200, "member": 200, "viewer": 200}),
    ("lista zespolu", "GET", "/api/v1/team", None,
     {"admin": 200, "coordinator": 200, "member": 200, "viewer": 200}),
    ("kalendarz", "GET", "/api/v1/calendar?starts_on=2026-09-07&ends_on=2026-09-14", None,
     {"admin": 200, "coordinator": 200, "member": 200, "viewer": 200}),
    ("wlasna dostepnosc", "GET", "/api/v1/availability/me", None,
     {"admin": 403, "coordinator": 200, "member": 200, "viewer": 403}),
    ("raport sprawiedliwosci", "GET", "/api/v1/fairness", None,
     {"admin": 200, "coordinator": 200, "member": 200, "viewer": 403}),
    ("lista zamian", "GET", "/api/v1/swaps", None,
     {"admin": 200, "coordinator": 200, "member": 200, "viewer": 403}),
    ("polityka generowania (odczyt)", "GET", "/api/v1/scheduling/policy", None,
     {"admin": 200, "coordinator": 200, "member": 403, "viewer": 403}),
    ("lista szkicow", "GET", "/api/v1/scheduling/drafts", None,
     {"admin": 200, "coordinator": 200, "member": 403, "viewer": 403}),
    ("zakolejkowanie generowania", "POST", "/api/v1/scheduling/runs",
     {"starts_on": "2027-03-01", "ends_on": "2027-03-07"},
     {"admin": 202, "coordinator": 202, "member": 403, "viewer": 403}),
    ("import historii (podglad listy)", "GET", "/api/v1/history/imports", None,
     {"admin": 200, "coordinator": 200, "member": 403, "viewer": 403}),
    ("raport miesieczny CSV", "GET", "/api/v1/reports/monthly.csv?month=2026-09", None,
     {"admin": 200, "coordinator": 200, "member": 403, "viewer": 403}),
    ("lista kont", "GET", "/api/v1/admin/users", None,
     {"admin": 200, "coordinator": 403, "member": 403, "viewer": 403}),
    ("audyt", "GET", "/api/v1/admin/audit", None,
     {"admin": 200, "coordinator": 403, "member": 403, "viewer": 403}),
    ("linki udostepnien", "GET", "/api/v1/admin/share-links", None,
     {"admin": 200, "coordinator": 403, "member": 403, "viewer": 403}),
    # Personal ICS feeds need a rotation member; admin has none, so it is turned
    # away with the same 403 as the viewer (LOW6-01/LOW6-02).
    ("kanaly ICS (wlasne)", "GET", "/api/v1/calendar/feeds", None,
     {"admin": 403, "coordinator": 200, "member": 200, "viewer": 403}),
    ("wydarzenia kalendarza (odczyt)", "GET",
     "/api/v1/calendar/events?starts_on=2026-09-01&ends_on=2026-09-30", None,
     {"admin": 200, "coordinator": 200, "member": 200, "viewer": 200}),
    ("override koordynatora", "POST", "/api/v1/calendar/override",
     {"service_date": "2026-09-30", "role": "primary",
      "replacement_member_id": members["Cezary Dudek"], "schedule_id": pub["id"]},
     {"member": 403, "viewer": 403}),
    ("zmiana polityki", "PUT", "/api/v1/scheduling/policy",
     {"rotation_mode": "hybrid"},
     {"member": 403, "viewer": 403}),
]

print(f"{'przypadek':38} " + " ".join(f"{r:>13}" for r in ROLES))
problems = []
for label, method, path, body, expect in CASES:
    cells = []
    for role in ROLES:
        if role not in expect:
            cells.append("-")
            continue
        api = sessions[role]
        fn = {"GET": api.get, "POST": api.post, "PUT": api.put, "DELETE": api.delete}[method]
        r = fn(path, **({"json": body} if body else {}))
        want = expect[role]
        ok = r.status_code == want
        if not ok:
            problems.append((label, role, r.status_code, want, r.text[:120]))
        cells.append(f"{r.status_code}{'' if ok else '!=' + str(want)}")
    print(f"{label:38} " + " ".join(f"{c:>13}" for c in cells))

print("\n--- bez sesji (anonim) ---")
for path in ("/api/v1/schedules/published", "/api/v1/fairness", "/api/v1/admin/users",
             "/api/v1/team", "/api/v1/scheduling/drafts", "/api/v1/auth/me"):
    r = anon.get(path)
    mark = "OK " if r.status_code in (401, 403) else "BLAD"
    print(f"[{mark}] GET {path:38} -> {r.status_code}")

print("\n--- CSRF ---")
c = httpx.Client(base_url="http://localhost:8080", timeout=30)
c.post("/api/v1/auth/login", json={"username": "adam.nowicki", "password": "QA6-Testowe-Haslo!"})
r = c.post("/api/v1/scheduling/runs", json={"starts_on": "2027-04-01", "ends_on": "2027-04-07"})
print(f"[{'OK ' if r.status_code in (401,403) else 'BLAD'}] zapis bez naglowka CSRF -> {r.status_code} {r.text[:120]}")

print("\nPROBLEMY:", len(problems))
for p in problems:
    print("  ", p)
