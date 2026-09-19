"""TC-A: authentication, session, CSRF, and the full RBAC matrix."""
import sys
from client import Api, check, FINDINGS, ADMIN_PASSWORD, PASSWORD

print("=== TC-A1 login/auth ===")
a = Api()
r = a.login("admin", "wrong-password-here")
check("A1.1", r.status_code == 401, "bad password rejected", str(r.status_code))
r = a.login("nosuchuser", PASSWORD)
check("A1.2", r.status_code == 401, "unknown user rejected", str(r.status_code))
r = a.login("admin", ADMIN_PASSWORD)
check("A1.3", r.status_code == 200, "admin login", r.text[:200])
check("A1.4", a.csrf is not None, "CSRF token returned on login")
r = a.get("/api/v1/auth/me")
check("A1.5", r.status_code == 200 and r.json()["role"] == "admin", "me returns admin")

# CSRF enforcement
r = a.c.post("/api/v1/auth/logout")
check("A1.6", r.status_code == 403, "mutating call without CSRF header rejected", str(r.status_code))
r = a.c.post("/api/v1/auth/logout", headers={"X-CSRF-Token": "bogus"})
check("A1.7", r.status_code == 403, "wrong CSRF token rejected", str(r.status_code))

# Unauthenticated access
anon = Api()
for path in ["/api/v1/auth/me", "/api/v1/team", "/api/v1/schedules/published",
             "/api/v1/fairness", "/api/v1/admin/users", "/api/v1/scheduling/drafts",
             "/api/v1/calendar?starts_on=2026-09-01&ends_on=2026-09-10"]:
    r = anon.get(path)
    check("A1.8", r.status_code == 401, f"anon 401 on {path}", str(r.status_code))

print()
print("=== TC-A2 RBAC matrix ===")
sessions = {
    "admin": Api("admin", ADMIN_PASSWORD),
    "coordinator": Api("koord"),
    "coordinator_member": Api("anna"),
    "member": Api("marek"),
    "viewer": Api("viewer"),
}
today = "2026-09-05"
MATRIX = [
    # (method, path, body, {role: expected_status_set})
    ("GET", "/api/v1/team", None,
     {"admin": {200}, "coordinator": {200}, "member": {200}, "viewer": {403}}),
    ("GET", "/api/v1/schedules/published", None,
     {"admin": {200}, "coordinator": {200}, "member": {200}, "viewer": {200}}),
    ("GET", f"/api/v1/calendar?starts_on={today}&ends_on=2026-09-20", None,
     {"admin": {200}, "coordinator": {200}, "member": {200}, "viewer": {200}}),
    ("GET", "/api/v1/fairness", None,
     {"admin": {200}, "coordinator": {200}, "member": {200}, "viewer": {403}}),
    ("GET", "/api/v1/availability/me", None,
     {"admin": {200, 409}, "coordinator": {200, 409}, "member": {200}, "viewer": {403}}),
    ("GET", "/api/v1/scheduling/policy", None,
     {"admin": {200}, "coordinator": {200}, "member": {403}, "viewer": {403}}),
    ("GET", "/api/v1/scheduling/drafts", None,
     {"admin": {200}, "coordinator": {200}, "member": {403}, "viewer": {403}}),
    ("GET", "/api/v1/admin/users", None,
     {"admin": {200}, "coordinator": {403}, "member": {403}, "viewer": {403}}),
    ("GET", "/api/v1/admin/audit", None,
     {"admin": {200}, "coordinator": {403}, "member": {403}, "viewer": {403}}),
    ("GET", "/api/v1/admin/share-links", None,
     {"admin": {200}, "coordinator": {403}, "member": {403}, "viewer": {403}}),
    ("GET", "/api/v1/reports/monthly.csv?month=2026-08", None,
     {"admin": {200}, "coordinator": {200}, "member": {403}, "viewer": {403}}),
    ("GET", "/api/v1/swaps", None,
     {"admin": {200}, "coordinator": {200}, "member": {200}, "viewer": {409, 403}}),
    ("GET", "/api/v1/calendar/feeds", None,
     {"admin": {200}, "coordinator": {200}, "member": {200}, "viewer": {403, 409}}),
]
for method, path, body, expected in MATRIX:
    for role, api in sessions.items():
        base_role = "coordinator" if role == "coordinator_member" else role
        exp = expected[base_role]
        r = api.req(method, path, **({"json": body} if body else {}))
        check("A2", r.status_code in exp,
              f"{role} {method} {path} -> {r.status_code} (expected {sorted(exp)})",
              r.text[:150])

print()
print("=== TC-A3 privilege escalation attempts ===")
m = sessions["member"]
r = m.post("/api/v1/scheduling/generate", json={"starts_on": "2026-10-01", "ends_on": "2026-10-07"})
check("A3.1", r.status_code == 403, "member cannot generate", str(r.status_code))
r = m.post("/api/v1/calendar/override", json={
    "schedule_id": "00000000-0000-0000-0000-000000000000", "expected_version": 1,
    "service_date": today, "role": "primary",
    "replacement_member_id": "00000000-0000-0000-0000-000000000000"})
check("A3.2", r.status_code == 403, "member cannot direct-override", str(r.status_code))
r = m.post("/api/v1/admin/users", json={"username": "hacker", "first_name": "H", "role": "admin"})
check("A3.3", r.status_code == 403, "member cannot create users", str(r.status_code))
v = sessions["viewer"]
r = v.get("/api/v1/fairness/duties?member_id=00000000-0000-0000-0000-000000000000")
check("A3.4", r.status_code == 403, "viewer cannot read duties", str(r.status_code))

# admin demoting/deactivating self
adm = sessions["admin"]
me_id = [u for u in adm.get("/api/v1/admin/users").json() if u["username"] == "admin"][0]["id"]
r = adm.patch(f"/api/v1/admin/users/{me_id}", json={"role": "viewer"})
check("A3.5", r.status_code == 409, "admin cannot demote self", str(r.status_code))
r = adm.patch(f"/api/v1/admin/users/{me_id}", json={"is_active": False})
check("A3.6", r.status_code == 409, "admin cannot deactivate self", str(r.status_code))

print()
print(f"--- {len(FINDINGS)} failures in this file ---")
for f in FINDINGS:
    print("  ", f)
