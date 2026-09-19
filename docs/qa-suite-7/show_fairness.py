import sys
sys.path.insert(0, "docs/qa-suite-7")
from api import Api
a = Api(sys.argv[1] if len(sys.argv) > 1 else "tomasz.krawczyk")
q = f"?as_of={sys.argv[2]}" if len(sys.argv) > 2 else ""
d = a.get("/api/v1/fairness" + q).json()
L = ("primary", "secondary", "late_shift", "weekends", "holidays")
print(d["window_start"], d["window_end"], "criterion_met", d["criterion_met"], "late_balanced", d["late_shift_balanced"])
print(f"{'osoba':20}{'od':>11}" + "".join(f"{x:>11}" for x in L))
for m in d["members"]:
    print(f"{m['display_name']:20}{m['active_from']:>11}" + "".join(f"{m[x]['deviation']:11.2f}" for x in L))
print("spread", " ".join(f"{x}={max(m[x]['deviation'] for m in d['members'])-min(m[x]['deviation'] for m in d['members']):.2f}" for x in L))
