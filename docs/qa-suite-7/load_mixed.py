"""QA7: mixed read load with real sessions.

Usage: load_mixed.py USERS SECONDS THINK_MIN THINK_MAX [label]
Each virtual user logs in as a real account (members, coordinators, a viewer),
then loops over a weighted set of screens the SPA actually loads. Coordinators
additionally hit reports, CSV export, fairness drill-down and draft impact.
Prints per-endpoint p50/p95/p99/max and error counts, JSON line to stdout end.
"""
import asyncio
import json
import random
import statistics
import sys
import time
from collections import defaultdict

import httpx

BASE = "http://localhost:8080"
PW = "QA7-Haslo-Testowe!"
MEMBERS = ["anna.wrobel", "bartosz.kowal", "celina.mazur", "dawid.lewandowski", "elzbieta.kaczmarek",
           "grzegorz.zielinski", "halina.szymanska", "igor.wojcik", "julia.nowak"]
COORDS = ["tomasz.krawczyk", "ewa.maj"]
VIEWERS = ["patryk.podglad"]

USERS, SECONDS = int(sys.argv[1]), float(sys.argv[2])
TMIN, TMAX = float(sys.argv[3]), float(sys.argv[4])
LABEL = sys.argv[5] if len(sys.argv) > 5 else ""

lat = defaultdict(list)
errors = defaultdict(int)
status_seen = defaultdict(lambda: defaultdict(int))


async def timed(c, name, method, url, **kw):
    t = time.perf_counter()
    try:
        r = await c.request(method, url, **kw)
        dt = (time.perf_counter() - t) * 1000
        lat[name].append(dt)
        status_seen[name][r.status_code] += 1
        if r.status_code >= 400:
            errors[name] += 1
        return r
    except Exception as exc:  # noqa: BLE001
        lat[name].append((time.perf_counter() - t) * 1000)
        errors[name] += 1
        status_seen[name][type(exc).__name__] += 1
        return None


async def user(i, deadline, ctx):
    pool = COORDS if i % 5 == 0 else (VIEWERS if i % 7 == 3 else MEMBERS)
    login = pool[i % len(pool)]
    role = "coord" if pool is COORDS else ("viewer" if pool is VIEWERS else "member")
    async with httpx.AsyncClient(base_url=BASE, timeout=60) as c:
        await asyncio.sleep(random.random() * 2)
        r = await timed(c, "login", "POST", "/api/v1/auth/login", json={"username": login, "password": PW})
        if r is None or r.status_code != 200:
            return
        await timed(c, "me", "GET", "/api/v1/auth/me")
        actions = [
            (5, "published", "GET", "/api/v1/schedules/published"),
            (5, "calendar_30d", "GET", "/api/v1/calendar?starts_on=2026-09-12&ends_on=2026-10-11"),
            (1, "calendar_35d_past", "GET", "/api/v1/calendar?starts_on=2026-08-01&ends_on=2026-09-04"),
        ]
        if role != "viewer":
            actions += [
                (3, "fairness", "GET", "/api/v1/fairness"),
                (2, "swaps", "GET", "/api/v1/swaps"),
                (2, "availability_me", "GET", "/api/v1/availability/me"),
            ]
        if role == "member":
            actions += [(1, "swap_options", "GET", f"/api/v1/swaps/options?schedule_id={ctx['sid']}&service_date=2026-09-24&role=primary")]
        if role == "coord":
            actions += [
                (2, "report_monthly", "GET", "/api/v1/reports/monthly?month=2026-08"),
                (1, "report_csv", "GET", "/api/v1/reports/monthly.csv?month=2026-08"),
                (2, "fairness_duties", "GET", f"/api/v1/fairness/duties?member_id={ctx['mid']}"),
                (1, "fairness_asof", "GET", "/api/v1/fairness?as_of=2026-06-30"),
                (1, "drafts", "GET", "/api/v1/scheduling/drafts"),
                (1, "audit", "GET", "/api/v1/admin/audit"),
                (1, "team", "GET", "/api/v1/team"),
            ]
            if ctx.get("draft"):
                actions += [(2, "draft_impact", "GET", f"/api/v1/scheduling/{ctx['draft']}/fairness-impact"),
                            (1, "draft_get", "GET", f"/api/v1/scheduling/{ctx['draft']}")]
        weights = [a[0] for a in actions]
        while time.monotonic() < deadline:
            _, name, method, url = random.choices(actions, weights)[0]
            await timed(c, name, method, url)
            await asyncio.sleep(random.uniform(TMIN, TMAX))


async def main():
    async with httpx.AsyncClient(base_url=BASE, timeout=60) as c:
        await c.post("/api/v1/auth/login", json={"username": "ewa.maj", "password": PW})
        sid = (await c.get("/api/v1/schedules/published")).json()["id"]
        mid = (await c.get("/api/v1/team")).json()[0]["id"]
        drafts = (await c.get("/api/v1/scheduling/drafts")).json()
    ctx = {"sid": sid, "mid": mid, "draft": drafts[0]["id"] if drafts else None}
    t0 = time.monotonic()
    deadline = t0 + SECONDS
    await asyncio.gather(*(user(i, deadline, ctx) for i in range(USERS)))
    wall = time.monotonic() - t0
    total = sum(len(v) for v in lat.values())
    out = {"label": LABEL, "users": USERS, "seconds": round(wall, 1), "think": [TMIN, TMAX],
           "requests": total, "rps": round(total / wall, 1), "errors": dict(errors), "endpoints": {}}
    print(f"{'endpoint':20}{'n':>6}{'p50':>8}{'p95':>8}{'p99':>8}{'max':>8}  err")
    for name in sorted(lat, key=lambda k: -statistics.quantiles(lat[k], n=100)[94] if len(lat[k]) > 1 else 0):
        v = sorted(lat[name])
        q = lambda p: v[min(len(v) - 1, int(p * len(v)))]
        out["endpoints"][name] = {"n": len(v), "p50": round(q(.5)), "p95": round(q(.95)), "p99": round(q(.99)), "max": round(v[-1])}
        print(f"{name:20}{len(v):6}{q(.5):8.0f}{q(.95):8.0f}{q(.99):8.0f}{v[-1]:8.0f}  {errors.get(name, 0)} {dict(status_seen[name]) if errors.get(name) else ''}")
    print(f"TOTAL {total} req, {out['rps']} rps, wall {wall:.0f}s")
    print("JSON " + json.dumps(out, ensure_ascii=False))


asyncio.run(main())
