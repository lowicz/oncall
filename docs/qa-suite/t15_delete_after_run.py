"""NEW-02: deleting an account that ever queued a generation run."""
import time
from datetime import date, timedelta

from client import ADMIN_PASSWORD, Api, FINDINGS, check

admin = Api("admin", ADMIN_PASSWORD)
TODAY = date.today()


def make_account(login: str) -> str:
    created = admin.post(
        "/api/v1/admin/users",
        json={"username": login, "first_name": "QA", "last_name": "Kasowany",
              "role": "coordinator"},
    )
    assert created.status_code == 201, created.text
    token = created.json()["activation_url"].split("token=")[-1]
    Api().c.post("/api/v1/auth/activate", json={"token": token, "password": "TestOncall2026!"})
    return created.json()["user"]["id"]


clean = make_account("qa_del_clean")
r = admin.delete(f"/api/v1/admin/users/{clean}")
check("N2.1", r.status_code == 204, "account that did nothing is deletable", str(r.status_code))

used = make_account("qa_del_used")
gen = Api("qa_del_used")
queued = gen.post(
    "/api/v1/scheduling/runs",
    json={"starts_on": str(TODAY + timedelta(days=800)),
          "ends_on": str(TODAY + timedelta(days=806))},
)
check("N2.2", queued.status_code == 202, "generation queued", str(queued.status_code))
time.sleep(2)
r = admin.delete(f"/api/v1/admin/users/{used}")
print("DELETE after a generation run ->", r.status_code, r.text[:160])
check("N2.3", r.status_code in (204, 409),
      "account that used the generator is deletable, or refused with a handled 409",
      str(r.status_code))

print()
for finding in FINDINGS:
    print("  ", finding)
