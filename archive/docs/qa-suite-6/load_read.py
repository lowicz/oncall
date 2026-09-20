"""QA6: 10 rownoczesnych uzytkownikow na sciezkach odczytu.

Cel sprzetowy to 2-4 rdzenie, wiec mierzymy opoznienie, nie przepustowosc
maksymalna: ile czeka czlonek zespolu, gdy caly zespol patrzy na grafik naraz.
"""
import statistics, sys, time
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, "docs/qa-suite-6")
from api import Api

LOGINY = ["adam.nowicki", "beata.lis", "cezary.dudek", "dorota.pawlak", "emil.zajac",
          "filip.gorski", "grazyna.wilk", "hubert.baran", "iwona.sadowska", "jakub.polak"]

SCIEZKI = [
    ("/api/v1/schedules/published", None),
    ("/api/v1/calendar", {"starts_on": "2026-09-07", "ends_on": "2026-10-06"}),
    ("/api/v1/fairness", None),
    ("/api/v1/team", None),
    ("/api/v1/auth/me", None),
]

sesje = {l: Api(l) for l in LOGINY}
RUND = 12


def praca(login):
    czasy = {}
    api = sesje[login]
    for path, params in SCIEZKI:
        proby = []
        for _ in range(RUND):
            t = time.perf_counter()
            r = api.get(path, params=params) if params else api.get(path)
            proby.append((time.perf_counter() - t) * 1000)
            if r.status_code >= 400:
                proby[-1] = float("nan")
        czasy[path] = proby
    return czasy


print(f"{len(LOGINY)} rownoczesnych sesji, {RUND} powtorzen kazdej sciezki\n")
start = time.perf_counter()
with ThreadPoolExecutor(max_workers=len(LOGINY)) as ex:
    wyniki = list(ex.map(praca, LOGINY))
calosc = time.perf_counter() - start

print(f"{'sciezka':52} {'n':>5} {'p50':>8} {'p95':>8} {'max':>8}")
for path, _ in SCIEZKI:
    proby = sorted(v for w in wyniki for v in w[path])
    n = len(proby)
    p50 = proby[n // 2]
    p95 = proby[int(n * 0.95)]
    print(f"{path:52} {n:>5} {p50:>7.0f}ms {p95:>7.0f}ms {proby[-1]:>7.0f}ms")
zad = len(LOGINY) * RUND * len(SCIEZKI)
print(f"\nlacznie {zad} zadan w {calosc:.1f} s -> {zad/calosc:.1f} zapytan/s")
