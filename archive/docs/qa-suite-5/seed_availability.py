"""Round 5 availability, entered by each member through their own account."""
import sys
from qa import Client

ENTRIES = [
    # user, kind, from, to, reason
    ("piotr.lewandowski", "unavailable", "2026-10-01", "2026-10-04", "Urlop rodzinny"),
    ("anna.kowalska", "unavailable", "2026-09-14", "2026-09-20", "Szkolenie zagraniczne"),
    ("magdalena.wozniak", "unavailable", "2026-09-08", "2026-09-09", "Wizyta lekarska"),
    ("julia.nowak", "prefer_not", "2026-09-21", "2026-09-27", "Remont mieszkania"),
    ("bartosz.mazur", "prefer", "2026-09-26", "2026-09-27", "Chętnie nadrobię weekend"),
    ("tomasz.szymanski", "prefer_not", "2026-10-05", "2026-10-09", "Konferencja"),
]

for username, kind, starts_on, ends_on, reason in ENTRIES:
    client = Client(username)
    response = client.post("/api/v1/availability/me", json={
        "kind": kind, "starts_on": starts_on, "ends_on": ends_on, "note": reason,
    })
    print(f"{username:22} {kind:12} {starts_on}..{ends_on} -> {response.status_code} {response.text[:120]}")
