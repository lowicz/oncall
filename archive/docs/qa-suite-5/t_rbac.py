"""RBAC and CSRF checks straight against the API, bypassing the SPA."""
import httpx

from qa import BASE, Client

RESULTS = []


def check(label: str, expected, actual, detail: str = "") -> None:
    ok = actual in expected if isinstance(expected, (list, tuple, set)) else actual == expected
    RESULTS.append((ok, label, f"oczekiwano {expected}, otrzymano {actual} {detail}".strip()))


clients = {name: Client(name) for name in
           ("admin", "ola.zielinska", "anna.kowalska", "kontroler.viewer", "halina.koordynator")}

READ_PATHS = [
    "/api/v1/schedules/published",
    "/api/v1/team",
    "/api/v1/fairness",
    "/api/v1/scheduling/drafts",
    "/api/v1/scheduling/policy",
    "/api/v1/scheduling/suggested-range",
    "/api/v1/admin/users",
    "/api/v1/admin/audit",
    "/api/v1/admin/share-links",
    "/api/v1/availability/me",
    "/api/v1/swaps",
    "/api/v1/reports/monthly?month=2026-08",
    "/api/v1/history/imports",
    "/api/v1/calendar?starts_on=2026-09-01&ends_on=2026-09-30",
    "/api/v1/calendar/feeds",
]

EXPECTED = {
    "kontroler.viewer": {
        "/api/v1/schedules/published": 200,
        "/api/v1/team": (200, 403),
        "/api/v1/fairness": 403,
        "/api/v1/scheduling/drafts": 403,
        "/api/v1/scheduling/policy": 403,
        "/api/v1/scheduling/suggested-range": 403,
        "/api/v1/admin/users": 403,
        "/api/v1/admin/audit": 403,
        "/api/v1/admin/share-links": 403,
        "/api/v1/availability/me": (403, 404),
        "/api/v1/swaps": 403,
        "/api/v1/reports/monthly?month=2026-08": 403,
        "/api/v1/history/imports": 403,
        "/api/v1/calendar?starts_on=2026-09-01&ends_on=2026-09-30": 200,
        "/api/v1/calendar/feeds": (200, 403),
    },
    "anna.kowalska": {
        "/api/v1/scheduling/drafts": 403,
        "/api/v1/scheduling/policy": 403,
        "/api/v1/scheduling/suggested-range": 403,
        "/api/v1/admin/users": 403,
        "/api/v1/admin/audit": 403,
        "/api/v1/admin/share-links": 403,
        "/api/v1/reports/monthly?month=2026-08": 403,
        "/api/v1/history/imports": 403,
    },
    "ola.zielinska": {
        "/api/v1/admin/users": 403,
        "/api/v1/admin/audit": 403,
        "/api/v1/admin/share-links": 403,
        "/api/v1/scheduling/drafts": 200,
        "/api/v1/reports/monthly?month=2026-08": 200,
    },
}

print("== A1-A5 odczyty ==")
for username, client in clients.items():
    for path in READ_PATHS:
        expected = EXPECTED.get(username, {}).get(path)
        code = client.get(path).status_code
        if expected is None:
            print(f"   {username:20} {path:55} -> {code}")
            continue
        check(f"{username} GET {path}", expected, code)

print("\n== A6 CSRF ==")
raw = httpx.Client(base_url=BASE, timeout=30)
raw.post("/api/v1/auth/login", json={"username": "ola.zielinska", "password": "OncallQA-2026!"})
check(
    "POST bez tokenu CSRF odrzucony",
    (401, 403),
    raw.post("/api/v1/scheduling/runs",
             json={"starts_on": "2026-11-02", "ends_on": "2026-11-08"}).status_code,
)
check(
    "POST z błędnym tokenem CSRF odrzucony",
    (401, 403),
    raw.post("/api/v1/scheduling/runs", headers={"X-CSRF-Token": "zle"},
             json={"starts_on": "2026-11-02", "ends_on": "2026-11-08"}).status_code,
)

print("\n== A7 konto nieaktywne ==")
anonymous = httpx.Client(base_url=BASE, timeout=30)
check("logowanie nieaktywnego konta", (401, 403),
      anonymous.post("/api/v1/auth/login",
                     json={"username": "dawid.stary", "password": "OncallQA-2026!"}).status_code)
check("logowanie błędnym hasłem", 401,
      anonymous.post("/api/v1/auth/login",
                     json={"username": "anna.kowalska", "password": "zle-haslo-123"}).status_code)

print("\n== A8 wylogowanie ==")
session = Client("anna.kowalska")
session.post("/api/v1/auth/logout")
check("po wylogowaniu /me odrzucone", 401, session.get("/api/v1/auth/me").status_code)

print("\n== A5 zapisy poza rolą ==")
member = clients["anna.kowalska"]
check("member nie utworzy szkicu", 403,
      member.post("/api/v1/scheduling/runs",
                  json={"starts_on": "2026-11-02", "ends_on": "2026-11-08"}).status_code)
check("member nie zmieni polityki", 403,
      member.put("/api/v1/scheduling/policy",
                 json={"rotation_mode": "daily", "fairness_weight": 1, "continuity_weight": 1,
                       "preference_weight": 1, "late_shift_anchor": "primary"}).status_code)
check("member nie utworzy konta", 403,
      member.post("/api/v1/admin/users",
                  json={"username": "haker", "first_name": "H", "last_name": "K",
                        "role": "admin"}).status_code)
coordinator = clients["ola.zielinska"]
check("koordynator nie utworzy konta", 403,
      coordinator.post("/api/v1/admin/users",
                       json={"username": "haker2", "first_name": "H", "last_name": "K",
                             "role": "admin"}).status_code)
check("koordynator nie utworzy linku viewer", 403,
      coordinator.post("/api/v1/admin/share-links",
                       json={"label": "x", "starts_on": "2026-09-07", "ends_on": "2026-09-10",
                             "expires_in_days": 5}).status_code)
viewer = clients["kontroler.viewer"]
check("viewer nie utworzy zamiany", 403,
      viewer.post("/api/v1/swaps", json={"service_date": "2026-09-10", "role": "primary",
                                         "replacement_member_id": "00000000-0000-0000-0000-000000000000"}
                  ).status_code)

failed = [item for item in RESULTS if not item[0]]
print(f"\nPRZESZŁO {len(RESULTS) - len(failed)}/{len(RESULTS)}")
for _ok, label, detail in failed:
    print(f"  BŁĄD  {label}: {detail}")
