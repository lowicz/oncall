"""TC-P1: does a generation run block every other request in the API process?"""
import threading, time
from datetime import date, timedelta
from client import Api, check, FINDINGS

TODAY = date.today()
koord = Api("koord")
probe = Api("marek")

latencies = []
stop = threading.Event()

def poll():
    while not stop.is_set():
        t0 = time.monotonic()
        try:
            r = probe.get("/api/v1/health")
            code = r.status_code
        except Exception as exc:
            code = str(exc)[:40]
        latencies.append((time.monotonic() - t0, code))
        time.sleep(0.25)

# baseline
t = threading.Thread(target=poll, daemon=True); t.start()
time.sleep(3)
base = [d for d, _ in latencies]
print(f"baseline /health latency: n={len(base)} max={max(base)*1000:.0f} ms avg={sum(base)/len(base)*1000:.0f} ms")
latencies.clear()

start = TODAY + timedelta(days=200)
t0 = time.monotonic()
r = koord.post("/api/v1/scheduling/generate",
               json={"starts_on": str(start), "ends_on": str(start + timedelta(days=90))})
gen = time.monotonic() - t0
time.sleep(1)
stop.set(); t.join(timeout=3)
during = [d for d, _ in latencies]
print(f"generation took {gen:.2f}s, status={r.status_code}")
print(f"/health during generation: n={len(during)} max={max(during)*1000:.0f} ms avg={sum(during)/len(during)*1000:.0f} ms")
check("P1.1", max(during) < 2.0,
      f"unrelated GET /health stays responsive during generation (max {max(during):.1f}s)")
if r.status_code == 201:
    Api("koord").delete(f"/api/v1/scheduling/{r.json()['id']}")
print()
for f in FINDINGS: print("  ", f)
