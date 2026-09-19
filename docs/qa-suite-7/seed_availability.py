"""QA7: availability filed by members themselves (Sept 28 - Oct 25 horizon) plus negative cases."""
import sys
sys.path.insert(0, "docs/qa-suite-7")
from api import Api

ENTRIES = [
    ("anna.wrobel", "unavailable", "2026-10-12", "2026-10-23", "Urlop"),
    ("bartosz.kowal", "prefer_not", "2026-10-03", "2026-10-04", "Wesele siostry"),
    ("celina.mazur", "prefer", "2026-10-17", "2026-10-18", "Chętnie wezmę weekend"),
    ("dawid.lewandowski", "unavailable", "2026-09-28", "2026-10-02", "Szkolenie"),
    ("elzbieta.kaczmarek", "prefer_not", "2026-10-19", "2026-10-25", "Remont"),
    ("grazyna.x", None, None, None, None),
    ("halina.szymanska", "unavailable", "2026-10-10", "2026-10-11", "Wyjazd"),
    ("igor.wojcik", "prefer", "2026-10-05", "2026-10-09", "Mogę więcej"),
    ("tomasz.krawczyk", "unavailable", "2026-10-24", "2026-10-25", "Maraton"),
]
for login, kind, a, b, note in ENTRIES:
    if kind is None:
        continue
    api = Api(login)
    r = api.post("/api/v1/availability/me", json={"kind": kind, "starts_on": a, "ends_on": b, "note": note})
    print(f"{login:20} {kind:12} {a}..{b} -> {r.status_code} {r.text[:160]}")

api = Api("bartosz.kowal")
cases = {
    "do<od": {"kind": "unavailable", "starts_on": "2026-10-10", "ends_on": "2026-10-01"},
    "zly kind": {"kind": "vacation", "starts_on": "2026-10-10", "ends_on": "2026-10-11"},
    "nakladajace": {"kind": "prefer", "starts_on": "2026-10-03", "ends_on": "2026-10-04"},
    "przeszlosc 2020": {"kind": "unavailable", "starts_on": "2020-01-01", "ends_on": "2020-01-02"},
    "3 lata": {"kind": "unavailable", "starts_on": "2026-10-01", "ends_on": "2029-10-01"},
    "note 600": {"kind": "prefer", "starts_on": "2026-11-01", "ends_on": "2026-11-01", "note": "x" * 600},
    "xss note": {"kind": "prefer_not", "starts_on": "2026-11-02", "ends_on": "2026-11-02", "note": "<img src=x onerror=alert(1)>"},
}
for name, body in cases.items():
    r = api.post("/api/v1/availability/me", json=body)
    print(f"NEG {name:16} -> {r.status_code} {r.text[:200]}")
v = Api("patryk.podglad")
print("viewer POST ->", v.post("/api/v1/availability/me", json=cases["xss note"]).status_code)
print("admin POST ->", Api("admin", "Qwertyuiop1!").post("/api/v1/availability/me", json=cases["xss note"]).status_code)
