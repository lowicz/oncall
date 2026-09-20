"""QA6: czy solver i raport licza ten sam 'uczciwy udzial'?

Raport: expected = (ekspozycja osoby / ekspozycja calkowita) * suma dyzurow,
        liczone raz na calym oknie 12 miesiecy konczacym sie ostatnim dniem szkicu.
Solver (scheduler.balance): expected = udzial w oknie historii * dyzury historyczne
        + udzial w horyzoncie * dyzury horyzontu, czyli dwie osobne proporcje.
Obie sa rowne tylko wtedy, gdy udzial osoby jest taki sam w obu podokresach.
Dla osoby, ktora dolaczyla w srodku okna, nie jest.
"""
import sys
from datetime import date, timedelta
sys.path.insert(0, "docs/qa-suite-6")
from api import Api
import holidays as hl

STARTS, ENDS = date(2026, 10, 5), date(2026, 11, 1)   # horyzont 28 dni
W_START, W_END = ENDS - timedelta(days=365), ENDS
H_START, H_END = W_START, STARTS - timedelta(days=1)

api = Api("adam.nowicki")
team = api.get("/api/v1/team").json()
active_from = {}
for m in team:
    active_from[m["display_name"]] = date.fromisoformat(m["active_from"])

pl = {x for x in hl.country_holidays("PL", years=range(2025, 2028))}
def days(a, b):
    return [a + timedelta(days=i) for i in range((b - a).days + 1)]
def w(d):
    return 2.0 if d.weekday() >= 5 or d in pl else 1.0

# Ekspozycja PRIMARY (waga punktowa), bez uwzglednienia niedostepnosci,
# czyli dokladnie tak, jak liczy raport.
def expo(name, ds):
    return sum(w(d) for d in ds if active_from[name] <= d)

hist_days, hor_days = days(H_START, H_END), days(STARTS, ENDS)
win_days = days(W_START, W_END)

# Faktyczne punkty primary w oknie historii, z raportu.
f = api.get("/api/v1/fairness", params={"as_of": W_END.isoformat()}).json()
hist_actual = {m["display_name"]: m["primary"]["actual"] for m in f["members"]}
A_hist = sum(hist_actual.values())
A_hor = sum(w(d) for d in hor_days)          # 1 slot primary dziennie

E_hist_tot = sum(expo(n, hist_days) for n in active_from)
E_hor_tot = sum(expo(n, hor_days) for n in active_from)
E_win_tot = sum(expo(n, win_days) for n in active_from)

print(f"okno {W_START} - {W_END} | historia do {H_END} | horyzont {STARTS} - {ENDS}")
print(f"punkty primary: historia={A_hist:.0f} horyzont={A_hor:.0f}\n")
print(f"{'osoba':18} {'udz.hist':>9} {'udz.horyz':>10} "
      f"{'oczek. raport':>14} {'oczek. solver':>14} {'roznica':>9}")
worst = 0.0
for n in sorted(active_from):
    sh_hist = expo(n, hist_days) / E_hist_tot
    sh_hor = expo(n, hor_days) / E_hor_tot
    sh_win = expo(n, win_days) / E_win_tot
    e_report = sh_win * (A_hist + A_hor)
    e_solver = sh_hist * A_hist + sh_hor * A_hor
    diff = e_solver - e_report
    worst = max(worst, abs(diff))
    flag = "  <-- dolaczyl(a) pozniej" if active_from[n] > W_START else ""
    print(f"{n:18} {sh_hist:9.4f} {sh_hor:10.4f} {e_report:14.2f} {e_solver:14.2f} {diff:+9.2f}{flag}")
print(f"\nnajwieksza rozbieznosc oczekiwanego udzialu: {worst:.2f} pkt")
print(f"kryterium odbioru to 3 pkt rozpietosci, wiec rozbieznosc {worst:.2f} pkt")
print("przesuwa odchylenie tej osoby o tyle samo w jedna strone u solvera,")
print("a w druga w raporcie - czyli az {:.0f}% budzetu kryterium.".format(100*worst/3))
