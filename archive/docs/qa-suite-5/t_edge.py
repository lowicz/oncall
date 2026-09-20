"""Boundaries and error paths that a coordinator can reach from the UI."""
from qa import Client

coordinator = Client("ola.zielinska")
admin = Client("admin")

def show(label, response):
    print(f"{label:58} {response.status_code} {response.text[:190]}")

show("zakres 92 dni", coordinator.post("/api/v1/scheduling/runs",
     json={"starts_on": "2027-05-01", "ends_on": "2027-07-31"}))
show("zakres odwrocony", coordinator.post("/api/v1/scheduling/runs",
     json={"starts_on": "2027-05-10", "ends_on": "2027-05-01"}))
show("zakres jednodniowy", coordinator.post("/api/v1/scheduling/runs",
     json={"starts_on": "2027-05-01", "ends_on": "2027-05-01"}))
show("polityka waga 101", coordinator.put("/api/v1/scheduling/policy",
     json={"rotation_mode": "hybrid", "fairness_weight": 101, "continuity_weight": 1,
           "preference_weight": 2, "late_shift_anchor": "secondary"}))
show("polityka waga ujemna", coordinator.put("/api/v1/scheduling/policy",
     json={"rotation_mode": "hybrid", "fairness_weight": -1, "continuity_weight": 1,
           "preference_weight": 2, "late_shift_anchor": "secondary"}))
show("polityka wszystkie wagi 0", coordinator.put("/api/v1/scheduling/policy",
     json={"rotation_mode": "hybrid", "fairness_weight": 0, "continuity_weight": 0,
           "preference_weight": 0, "late_shift_anchor": "secondary"}))
coordinator.put("/api/v1/scheduling/policy",
                json={"rotation_mode": "hybrid", "fairness_weight": 3, "continuity_weight": 1,
                      "preference_weight": 2, "late_shift_anchor": "secondary"})
show("link viewer na 31 dni", admin.post("/api/v1/admin/share-links",
     json={"label": "x", "starts_on": "2026-09-10", "ends_on": "2026-09-20", "expires_days": 31}))
show("dostepnosc 400 dni", Client("anna.kowalska").post("/api/v1/availability/me",
     json={"kind": "prefer_not", "starts_on": "2026-11-01", "ends_on": "2028-01-01"}))
show("dostepnosc odwrocona", Client("anna.kowalska").post("/api/v1/availability/me",
     json={"kind": "prefer_not", "starts_on": "2026-11-10", "ends_on": "2026-11-01"}))
show("raport zly miesiac", coordinator.get("/api/v1/reports/monthly?month=2026-13"))
show("raport bez miesiaca", coordinator.get("/api/v1/reports/monthly"))
show("kalendarz zakres odwrocony",
     coordinator.get("/api/v1/calendar?starts_on=2026-10-01&ends_on=2026-09-01"))
show("kalendarz 5 lat",
     coordinator.get("/api/v1/calendar?starts_on=2022-01-01&ends_on=2027-01-01"))
show("fairness w przyszlosci", coordinator.get("/api/v1/fairness?as_of=2030-01-01"))
show("nieistniejacy szkic", coordinator.get("/api/v1/scheduling/00000000-0000-0000-0000-000000000000"))
show("publikacja szkicu w stanie draft", coordinator.post(
     "/api/v1/scheduling/28b017ac-8e4a-4487-9155-35a2297908b3/publish",
     json={"expected_version": 1}))
