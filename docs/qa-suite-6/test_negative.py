"""QA6: negative and boundary cases against the real API."""
import sys, json
from datetime import date
sys.path.insert(0, "docs/qa-suite-6")
from api import Api

coord = Api("adam.nowicki")
members = {m["display_name"]: m["id"] for m in coord.get("/api/v1/team").json()}
sched = coord.get("/api/v1/schedules/published").json()
sid = sched["id"]


def t(name, resp, expect):
    ok = resp.status_code == expect
    body = resp.text[:160].replace("\n", " ")
    print(f"[{'OK ' if ok else 'BLAD'}] {name}: {resp.status_code} (oczekiwano {expect}) {body}")


# --- override: hard rules ---
t("override na osobe niedostepna (Jakub 09-08)",
  coord.post("/api/v1/calendar/override", json={
      "service_date": "2026-09-08", "role": "primary",
      "replacement_member_id": members["Jakub Polak"], "schedule_id": sid}), 422)

t("override 11-19 w sobote",
  coord.post("/api/v1/calendar/override", json={
      "service_date": "2026-09-12", "role": "late_shift",
      "replacement_member_id": members["Adam Nowicki"], "schedule_id": sid}), 422)

t("override na osobe bez eligibility 11-19 (Emil)",
  coord.post("/api/v1/calendar/override", json={
      "service_date": "2026-09-16", "role": "late_shift",
      "replacement_member_id": members["Emil Zając"], "schedule_id": sid}), 422)

t("override: ta sama osoba w primary i secondary (09-16 Hubert jest S)",
  coord.post("/api/v1/calendar/override", json={
      "service_date": "2026-09-16", "role": "primary",
      "replacement_member_id": members["Hubert Baran"], "schedule_id": sid}), 422)

t("override na osobe juz pelniaca te role",
  coord.post("/api/v1/calendar/override", json={
      "service_date": "2026-09-16", "role": "primary",
      "replacement_member_id": members["Dorota Pawlak"], "schedule_id": sid}), 422)

t("override poza zakresem opublikowanego grafiku",
  coord.post("/api/v1/calendar/override", json={
      "service_date": "2027-01-15", "role": "primary",
      "replacement_member_id": members["Adam Nowicki"]}), 404)

# --- override/check: soft warnings ---
r = coord.post("/api/v1/calendar/override/check", json={
    "service_date": "2026-09-19", "role": "primary",
    "replacement_member_id": members["Dorota Pawlak"], "schedule_id": sid})
print(f"[INFO] override/check na 'wole nie' (Dorota 09-19): {r.status_code} {r.text[:300]}")

r = coord.post("/api/v1/calendar/override/check", json={
    "service_date": "2026-09-24", "role": "primary",
    "replacement_member_id": members["Iwona Sadowska"], "schedule_id": sid})
print(f"[INFO] override/check lamiacy rozrzedzanie (Iwona 09-24, ma S 23/24/25): {r.status_code} {r.text[:400]}")

# --- generator: range validation ---
t("generowanie 36 dni",
  coord.post("/api/v1/scheduling/runs", json={"starts_on": "2026-11-01", "ends_on": "2026-12-06"}), 422)
t("generowanie z data konca przed poczatkiem",
  coord.post("/api/v1/scheduling/runs", json={"starts_on": "2026-11-10", "ends_on": "2026-11-01"}), 422)

# --- policy validation ---
t("polityka: budzet 4 s",
  coord.put("/api/v1/scheduling/policy", json={"rotation_mode": "hybrid", "solve_seconds": 4}), 422)
t("polityka: budzet 301 s",
  coord.put("/api/v1/scheduling/policy", json={"rotation_mode": "hybrid", "solve_seconds": 301}), 422)
t("polityka: waga 101",
  coord.put("/api/v1/scheduling/policy", json={"rotation_mode": "hybrid", "fairness_weight": 101}), 422)

# --- availability validation ---
m = Api("beata.lis")
t("dostepnosc calkowicie w przeszlosci",
  m.post("/api/v1/availability/me", json={"kind": "unavailable",
        "starts_on": "2025-01-01", "ends_on": "2025-01-05"}), 422)
t("dostepnosc nakladajaca sie na istniejaca",
  m.post("/api/v1/availability/me", json={"kind": "prefer_not",
        "starts_on": "2026-09-20", "ends_on": "2026-09-22"}), 409)
t("dostepnosc z data konca przed poczatkiem",
  m.post("/api/v1/availability/me", json={"kind": "prefer",
        "starts_on": "2026-12-10", "ends_on": "2026-12-01"}), 422)
