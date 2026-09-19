"""TC-F: edge cases, validation gaps and data-integrity probes."""
from datetime import date, timedelta
from client import Api, check, FINDINGS, ADMIN_PASSWORD

TODAY = date.today()
admin = Api("admin", ADMIN_PASSWORD); koord = Api("koord"); ola = Api("ola")
team = {m["display_name"]: m for m in koord.get("/api/v1/team").json()}

print("=== TC-F1 availability validation ===")
base = {"kind": "unavailable", "starts_on": str(TODAY + timedelta(days=200)),
        "ends_on": str(TODAY + timedelta(days=210)), "note": "QA A"}
r = ola.post("/api/v1/availability/me", json=base)
check("F1.1", r.status_code == 201, "availability created", r.text[:150])
first = r.json()["id"] if r.status_code == 201 else None
# contradictory overlapping entry
contra = dict(base, kind="prefer", note="QA sprzeczne")
r = ola.post("/api/v1/availability/me", json=contra)
check("F1.2", r.status_code >= 400,
      "contradictory overlapping entry (nie mogę + chętnie wezmę, same dates) rejected",
      str(r.status_code))
second = r.json().get("id") if r.status_code == 201 else None
# identical duplicate
r = ola.post("/api/v1/availability/me", json=base)
check("F1.3", r.status_code >= 400, "exact duplicate entry rejected", str(r.status_code))
third = r.json().get("id") if r.status_code == 201 else None
# past dates
r = ola.post("/api/v1/availability/me", json={"kind": "unavailable",
      "starts_on": str(TODAY - timedelta(days=400)), "ends_on": str(TODAY - timedelta(days=390))})
check("F1.4", r.status_code >= 400, "availability entirely in the past rejected", str(r.status_code))
past = r.json().get("id") if r.status_code == 201 else None
# reversed range
r = ola.post("/api/v1/availability/me", json={"kind": "unavailable",
      "starts_on": str(TODAY + timedelta(days=10)), "ends_on": str(TODAY + timedelta(days=5))})
check("F1.5", r.status_code == 422, "reversed range rejected", str(r.status_code))
# delete somebody else's entry
if first:
    r = Api("piotr").delete(f"/api/v1/availability/me/{first}")
    check("F1.6", r.status_code == 404, "cannot delete another member's entry", str(r.status_code))
for eid in (first, second, third, past):
    if eid: ola.delete(f"/api/v1/availability/me/{eid}")

print()
print("=== TC-F2 account administration ===")
r = admin.post("/api/v1/admin/users", json={"username": "qa_temp", "first_name": "QA",
                                            "last_name": "Tymczasowy", "role": "member",
                                            "email": "qa_temp@example.com"})
check("F2.1", r.status_code == 201, "user created", r.text[:200])
created = r.json() if r.status_code == 201 else {}
uid = created.get("user", {}).get("id")
print("  activation url:", created.get("activation_url", "")[:70])
r = admin.post("/api/v1/admin/users", json={"username": "qa_temp", "first_name": "X", "role": "member"})
check("F2.2", r.status_code == 409, "duplicate login rejected", str(r.status_code))
for bad in [{"username": "a b", "first_name": "X"}, {"username": "", "first_name": "X"},
            {"username": "qa2", "first_name": "  "}, {"username": "qa3", "first_name": "X",
             "personnel_number": "abc"}]:
    r = admin.post("/api/v1/admin/users", json=bad)
    check("F2.3", r.status_code in (409, 422), f"rejected {bad}", str(r.status_code))
# cannot log in before activation
pre = Api()
r = pre.login("qa_temp", "TestOncall2026!")
check("F2.4", r.status_code == 401, "account without a password cannot log in", str(r.status_code))
# activation
token = created.get("activation_url", "").split("token=")[-1]
r = pre.c.post("/api/v1/auth/activate", json={"token": token, "password": "short"})
check("F2.5", r.status_code == 422, "activation password under 12 chars rejected", str(r.status_code))
r = pre.c.post("/api/v1/auth/activate", json={"token": token, "password": "TestOncall2026!"})
check("F2.6", r.status_code == 204, "activation succeeds", r.text[:150])
r = pre.c.post("/api/v1/auth/activate", json={"token": token, "password": "TestOncall2026!"})
check("F2.7", r.status_code in (400, 409), "activation token is single-use", str(r.status_code))
r = pre.login("qa_temp", "TestOncall2026!")
check("F2.8", r.status_code == 200, "activated account logs in", str(r.status_code))
# password reset invalidates sessions
sess = Api("qa_temp")
r = admin.post(f"/api/v1/admin/users/{uid}/reset")
check("F2.9", r.status_code == 200, "reset link issued", r.text[:150])
rt = r.json()["url"].split("token=")[-1] if r.status_code == 200 else None
if rt:
    r2 = pre.c.post("/api/v1/auth/reset", json={"token": rt, "password": "NoweHaslo2026!!"})
    check("F2.10", r2.status_code == 204, "reset applied", r2.text[:150])
    r3 = sess.get("/api/v1/auth/me")
    check("F2.11", r3.status_code == 401, "existing sessions killed by a password reset",
          str(r3.status_code))
# deactivation kills the session
sess2 = Api("qa_temp", "NoweHaslo2026!!")
check("F2.12", sess2.csrf is not None, "login with the new password")
r = admin.patch(f"/api/v1/admin/users/{uid}", json={"is_active": False})
check("F2.13", r.status_code == 200, "deactivated", r.text[:150])
r = sess2.get("/api/v1/auth/me")
check("F2.14", r.status_code == 401, "deactivation kills the live session", str(r.status_code))
r = Api().login("qa_temp", "NoweHaslo2026!!")
check("F2.15", r.status_code == 401, "deactivated account cannot log in", str(r.status_code))
# no delete endpoint
r = admin.delete(f"/api/v1/admin/users/{uid}")
check("F2.16", r.status_code != 405, f"account can be deleted or archived (got {r.status_code})")

print()
print("=== TC-F3 rotation membership and eligibility ===")
# F2.16 may have deleted the account; the rotation tests need a live one.
if admin.get(f"/api/v1/admin/users").status_code == 200 and not [
    u for u in admin.get("/api/v1/admin/users").json() if u["id"] == uid
]:
    fresh = admin.post("/api/v1/admin/users", json={
        "username": "qa_rot", "first_name": "QA", "last_name": "Rotacja", "role": "member"})
    uid = fresh.json()["user"]["id"]
admin.patch(f"/api/v1/admin/users/{uid}", json={"is_active": True})
r = admin.post("/api/v1/admin/team-members",
               json={"user_id": uid, "active_from": str(TODAY - timedelta(days=5))})
check("F3.1", r.status_code == 201, "team member created", r.text[:200])
mid = r.json()["id"] if r.status_code == 201 else None
r = admin.post("/api/v1/admin/team-members", json={"user_id": uid, "active_from": str(TODAY)})
check("F3.2", r.status_code == 409, "one account cannot join the rotation twice", str(r.status_code))
if mid:
    r = admin.post(f"/api/v1/admin/team-members/{mid}/eligibility",
                   json={"role": "primary", "starts_on": str(TODAY - timedelta(days=5))})
    check("F3.3", r.status_code == 201, "eligibility created", r.text[:200])
    eid = r.json()["id"] if r.status_code == 201 else None
    r = admin.post(f"/api/v1/admin/team-members/{mid}/eligibility",
                   json={"role": "primary", "starts_on": str(TODAY)})
    check("F3.4", r.status_code == 409, "overlapping eligibility rejected", str(r.status_code))
    r = admin.post(f"/api/v1/admin/team-members/{mid}/eligibility",
                   json={"role": "primary", "starts_on": str(TODAY - timedelta(days=30))})
    check("F3.5", r.status_code == 409, "eligibility before joining rejected", str(r.status_code))
    if eid:
        r = admin.delete(f"/api/v1/admin/eligibility/{eid}")
        check("F3.6", r.status_code in (204, 200),
              f"eligibility can be removed (got {r.status_code})")
    # removing somebody from the rotation while they hold future duties
    pubs = koord.get("/api/v1/schedules/published").json()
    victim = [a for a in pubs["assignments"]
              if date.fromisoformat(a["service_date"]) > TODAY + timedelta(days=3)][0]
    vid = team[victim["assignee_name"]]["id"]
    r = admin.patch(f"/api/v1/admin/team-members/{vid}",
                    json={"active_until": str(TODAY + timedelta(days=1))})
    check("F3.7", r.status_code >= 400,
          f"cannot end rotation membership while future duties are assigned "
          f"({victim['assignee_name']} on {victim['service_date']}, got {r.status_code})")
    if r.status_code == 200:
        admin.patch(f"/api/v1/admin/team-members/{vid}", json={"active_until": None})

print()
print("=== TC-F4 calendar range validation ===")
for s, e, exp in [(TODAY, TODAY + timedelta(days=200), 422),
                  (TODAY, TODAY - timedelta(days=1), 422),
                  (TODAY, TODAY, 200)]:
    r = koord.get(f"/api/v1/calendar?starts_on={s}&ends_on={e}")
    check("F4.1", r.status_code == exp, f"calendar {s}..{e} -> {r.status_code}", r.text[:120])

print()
print("=== TC-F5 pagination and limits ===")
r = koord.get("/api/v1/swaps?limit=500")
check("F5.1", r.status_code == 422, "swap limit capped", str(r.status_code))
r = admin.get("/api/v1/admin/audit?limit=501")
check("F5.2", r.status_code == 422, "audit limit capped", str(r.status_code))

print()
print(f"--- {len(FINDINGS)} failures ---")
for f in FINDINGS: print("  ", f)
