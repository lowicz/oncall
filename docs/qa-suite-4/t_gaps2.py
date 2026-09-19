"""C3 częściowa republikacja, B6 tryb tygodniowy, G2 porównanie wariantów."""
import time
from datetime import date, timedelta

from qa import Client

coordinator = Client("ola.zielinska")


def policy(mode: str) -> None:
    coordinator.put("/api/v1/scheduling/policy",
                    json={"rotation_mode": mode, "fairness_weight": 3.0,
                          "continuity_weight": 1.0, "preference_weight": 2.0,
                          "late_shift_anchor": "secondary"})


def generate(starts_on: str, ends_on: str) -> str | None:
    run_id = coordinator.post("/api/v1/scheduling/runs",
                              json={"starts_on": starts_on, "ends_on": ends_on}).json()["id"]
    while True:
        state = coordinator.get(f"/api/v1/scheduling/runs/{run_id}").json()
        if state["status"] in ("completed", "failed"):
            break
        time.sleep(1)
    if state["status"] != "completed":
        print("   generowanie nieudane:", state.get("error"))
        return None
    return state["schedule_id"]


def publish(schedule_id: str) -> None:
    schedule = coordinator.get(f"/api/v1/scheduling/{schedule_id}").json()
    proposed = coordinator.post(f"/api/v1/scheduling/{schedule_id}/propose",
                                json={"expected_version": schedule["version"]})
    version = proposed.json()["version"] if proposed.status_code == 200 else schedule["version"]
    published = coordinator.post(f"/api/v1/scheduling/{schedule_id}/publish",
                                 json={"expected_version": version})
    print("   propose:", proposed.status_code, "publish:", published.status_code)


def who(day: str) -> dict:
    items = coordinator.get("/api/v1/calendar",
                            params={"starts_on": day, "ends_on": day}).json()["assignments"]
    return {i["role"]: (i["assignee_name"], i["schedule_id"][:8]) for i in items}


print("== C3 częściowa republikacja ==")
policy("hybrid")
long_id = generate("2027-03-01", "2027-03-28")
if long_id:
    publish(long_id)
    before = {day: who(day) for day in ("2027-03-05", "2027-03-10", "2027-03-25")}
    for day, row in before.items():
        print(f"   przed  {day}: {row}")
    short_id = generate("2027-03-09", "2027-03-15")
    if short_id:
        publish(short_id)
        for day in ("2027-03-05", "2027-03-10", "2027-03-25"):
            print(f"   po     {day}: {who(day)}")
        summaries = coordinator.get("/api/v1/scheduling/drafts").json()
        print("   statusy:", [(s["name"][:34], s["status"]) for s in summaries])

print("\n== B6 tryb tygodniowy: brak reguł rozrzedzania ==")
policy("weekly")
weekly_id = generate("2027-04-05", "2027-05-02")
if weekly_id:
    schedule = coordinator.get(f"/api/v1/scheduling/{weekly_id}").json()
    runs = {}
    for item in schedule["assignments"]:
        if item["role"] in ("primary", "secondary"):
            runs.setdefault(item["assignee_name"], set()).add(date.fromisoformat(item["service_date"]))
    longest = 0
    for name, days in runs.items():
        ordered = sorted(days)
        streak = 1
        for a, b in zip(ordered, ordered[1:]):
            streak = streak + 1 if b - a == timedelta(days=1) else 1
            longest = max(longest, streak)
    print(f"   tryb: {schedule['rotation_mode']}, najdłuższa seria kolejnych dyżurów: {longest}")
    print("   oczekiwane: powyżej 3, bo reguły rozrzedzania nie obowiązują w trybie tygodniowym")

print("\n== G2 porównanie wariantu dziennego i tygodniowego ==")
policy("daily")
daily_id = generate("2027-06-07", "2027-07-04")
policy("weekly")
weekly2_id = generate("2027-06-07", "2027-07-04")
if daily_id and weekly2_id:
    compared = coordinator.get("/api/v1/scheduling/compare",
                               params={"daily_id": daily_id, "weekly_id": weekly2_id})
    print("   porównanie:", compared.status_code)
    if compared.status_code == 200:
        import json
        print("   ", json.dumps(compared.json(), ensure_ascii=False)[:700])
policy("hybrid")
