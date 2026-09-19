"""Concurrent read load against the API, reported as latency percentiles."""
import statistics
import sys
import threading
import time
from collections import defaultdict

from qa import Client

USERS = [
    "anna.kowalska", "marek.wisniewski", "ola.zielinska", "piotr.lewandowski",
    "katarzyna.dabrowska", "tomasz.szymanski", "magdalena.wozniak", "rafal.kaminski",
    "julia.nowak", "bartosz.mazur", "kontroler.viewer", "admin",
]

SCENARIOS = {
    "odczyt": [
        ("/api/v1/schedules/published", None),
        ("/api/v1/calendar?starts_on=2026-09-06&ends_on=2026-10-05", None),
        ("/api/v1/auth/me", None),
        ("/api/v1/team", None),
    ],
    "raporty": [
        ("/api/v1/fairness", None),
        ("/api/v1/reports/monthly?month=2026-09", {"coordinator"}),
        ("/api/v1/calendar?starts_on=2026-09-06&ends_on=2026-10-05", None),
    ],
}

COORDINATORS = {"ola.zielinska", "admin"}
DURATION = float(sys.argv[2]) if len(sys.argv) > 2 else 30.0
scenario = SCENARIOS[sys.argv[1]]
count = int(sys.argv[3]) if len(sys.argv) > 3 else 10

samples: dict[str, list[float]] = defaultdict(list)
errors: dict[str, int] = defaultdict(int)
lock = threading.Lock()
stop_at = 0.0


def worker(username: str) -> None:
    client = Client(username)
    while time.perf_counter() < stop_at:
        for path, restriction in scenario:
            if restriction and username not in COORDINATORS:
                continue
            began = time.perf_counter()
            try:
                response = client.get(path)
                took = time.perf_counter() - began
                with lock:
                    if response.status_code == 200:
                        samples[path].append(took)
                    else:
                        errors[f"{path} {response.status_code}"] += 1
            except Exception as error:  # noqa: BLE001
                with lock:
                    errors[f"{path} {type(error).__name__}"] += 1


threads = [threading.Thread(target=worker, args=(USERS[index % len(USERS)],))
           for index in range(count)]
stop_at = time.perf_counter() + DURATION + 6
warmup = [Client(name) for name in USERS[:1]]
stop_at = time.perf_counter() + DURATION
for thread in threads:
    thread.start()
for thread in threads:
    thread.join()

print(f"scenariusz={sys.argv[1]} uzytkownicy={count} czas={DURATION}s")
print(f"{'sciezka':60}{'n':>7}{'p50':>9}{'p95':>9}{'p99':>9}{'max':>9}")
for path, values in sorted(samples.items()):
    values.sort()
    def pct(fraction):
        return values[min(len(values) - 1, int(len(values) * fraction))]
    print(f"{path[:58]:60}{len(values):>7}{pct(0.5)*1000:>8.0f}m{pct(0.95)*1000:>8.0f}m"
          f"{pct(0.99)*1000:>8.0f}m{values[-1]*1000:>8.0f}m")
total = sum(len(v) for v in samples.values())
print(f"razem zapytan={total} przepustowosc={total/DURATION:.1f} req/s bledy={dict(errors)}")
