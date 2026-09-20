"""Pasek postępu w prawdziwym przebiegu: czy stoi, czy się rusza.

Przed poprawką odczyty szły 10 -> 30 -> 100. Teraz między 30 a 90 powinno
pojawić się kilka wartości pośrednich.
"""
import sys
import time

sys.path.insert(0, "/home/lowicz/Work/oncall/docs/qa-suite-5")
from qa import Client

koord = Client("ola.zielinska")
run = koord.post(
    "/api/v1/scheduling/runs", json={"starts_on": "2027-08-02", "ends_on": "2027-08-29"}
)
run.raise_for_status()
run_id = run.json()["id"]

seen: list[int] = []
while True:
    state = koord.get(f"/api/v1/scheduling/runs/{run_id}").json()
    if not seen or state["progress"] != seen[-1]:
        seen.append(state["progress"])
    if state["status"] in ("completed", "failed"):
        break
    time.sleep(0.5)

print("odczyty paska:", seen)
between = [value for value in seen if 30 < value < 90]
print("wartości między 30 a 90:", between)
print("monotoniczny:", seen == sorted(seen))
if state["schedule_id"]:
    koord.delete(f"/api/v1/scheduling/{state['schedule_id']}")
