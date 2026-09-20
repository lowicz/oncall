"""QA6: availability entries created by the members themselves, through the API."""
import sys
sys.path.insert(0, "docs/qa-suite-6")
from api import Api

# login, kind, from, to, note
ENTRIES = [
    ("beata.lis",      "unavailable", "2026-09-14", "2026-09-27", "Urlop wypoczynkowy"),
    ("cezary.dudek",   "unavailable", "2026-09-10", "2026-09-13", "Wyjazd rodzinny"),
    ("dorota.pawlak",  "prefer_not",  "2026-09-19", "2026-09-20", "Wesele"),
    ("emil.zajac",     "prefer",      "2026-09-26", "2026-09-27", "Chętnie wezmę weekend"),
    ("filip.gorski",   "unavailable", "2026-10-05", "2026-10-11", "Szkolenie"),
    ("grazyna.wilk",   "prefer_not",  "2026-09-28", "2026-10-02", "Remont"),
    ("hubert.baran",   "prefer",      "2026-10-17", "2026-10-18", "Mogę wziąć weekend"),
    ("jakub.polak",    "unavailable", "2026-09-07", "2026-09-09", "Onboarding"),
]

for login, kind, a, b, note in ENTRIES:
    api = Api(login)
    r = api.post("/api/v1/availability/me",
                 json={"kind": kind, "starts_on": a, "ends_on": b, "note": note})
    warn = r.json().get("warning") if r.status_code < 300 else r.text[:200]
    print(f"{login:16} {kind:12} {a}..{b}  -> {r.status_code} {warn or ''}")
