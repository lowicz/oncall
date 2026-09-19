import sys
sys.path.insert(0, "docs/qa-suite-6")
from api import Api

api = Api(sys.argv[1] if len(sys.argv) > 1 else "adam.nowicki")
r = api.get("/api/v1/fairness")
print(r.status_code)
d = r.json()
print("okno:", d.get("window_start"), "-", d.get("window_end"))
print(f"{'osoba':16} " + " ".join(f"{l:>22}" for l in ("primary","secondary","late_shift","weekends","holidays")))
lenses = ("primary","secondary","late_shift","weekends","holidays")
devs = {l: [] for l in lenses}
for m in d["members"]:
    cells = []
    for l in lenses:
        c = m[l]
        devs[l].append(c["deviation"])
        cells.append(f"{c['actual']:6.1f}/{c['expected']:6.1f}={c['deviation']:+6.2f}")
    print(f"{m['display_name']:16} " + " ".join(f"{c:>22}" for c in cells))
print()
for l in lenses:
    print(f"rozpietosc {l:12}: {max(devs[l])-min(devs[l]):.2f}")
print("\nklucze odpowiedzi:", sorted(d.keys()))
