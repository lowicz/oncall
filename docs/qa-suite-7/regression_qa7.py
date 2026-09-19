"""Regression guard for QA-REPORT-7's blockers and high-severity defects.

Run after `rebuild_state.py --with-scenarios` on a fresh stack (from the
repository root):

    backend/.venv/bin/python docs/qa-suite-7/rebuild_state.py --with-scenarios
    backend/.venv/bin/python docs/qa-suite-7/regression_qa7.py

Each scenario below reproduces one defect's own repro steps from the report
(par. 5.1-5.2) against the live API and asserts the fixed outcome, so a
regression fails this script instead of silently shipping again (QA7-L21).
Exits 0 when every scenario is OK, 1 otherwise.

The QA7-H08 scenario runs last and deliberately trips the login throttle
(E1) for this runner's IP; running the script again right afterwards will
see every login 429 until that window (`Retry-After`, exponential) passes -
expected, not a regression.
"""

from __future__ import annotations

import subprocess
import sys
import time
from collections.abc import Callable
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import httpx

sys.path.insert(0, str(Path(__file__).parent))

from api import BASE, Api  # noqa: E402
from rebuild_state import ROOT, generate, member_ids, require  # noqa: E402

GENERATION_TIMEOUT = 300.0

#: The QA7 roster (QA-REPORT-7 par. 2) with a real, working login - Robert
#: Baran's account is disabled and Julia Nowak joined later, both used below
#: for exactly that reason rather than excluded.
NAME_TO_LOGIN = {
    "Tomasz Krawczyk": "tomasz.krawczyk",
    "Anna Wróbel": "anna.wrobel",
    "Bartosz Kowal": "bartosz.kowal",
    "Celina Mazur": "celina.mazur",
    "Dawid Lewandowski": "dawid.lewandowski",
    "Elżbieta Kaczmarek": "elzbieta.kaczmarek",
    "Grzegorz Zieliński": "grzegorz.zielinski",
    "Halina Szymańska": "halina.szymanska",
    "Igor Wójcik": "igor.wojcik",
    "Julia Nowak": "julia.nowak",
}
#: Igor Wójcik never holds primary (QA-REPORT-7 par. 2) - excluded here so a
#: scenario picking a stand-in for the role never hits that constraint.
PRIMARY_CANDIDATES = [name for name in NAME_TO_LOGIN if name != "Igor Wójcik"]

FAILURES: list[str] = []


def run(qa_id: str, scenario: Callable[[], None]) -> None:
    try:
        scenario()
    except Exception as error:  # noqa: BLE001 - the failure itself is the report
        FAILURES.append(qa_id)
        print(f"FAIL {qa_id}: {error}")
    else:
        print(f"OK   {qa_id}")


def check_b01_member_fairness_matches_coordinator_row() -> None:
    coordinator = Api("tomasz.krawczyk")
    team = require(coordinator.get("/api/v1/fairness"), "team fairness")
    row = next(m for m in team["members"] if m["display_name"] == "Bartosz Kowal")
    member = Api("bartosz.kowal")
    own = require(member.get("/api/v1/fairness"), "own fairness")
    assert len(own["members"]) == 1, f"expected exactly one row, got {len(own['members'])}"
    mine = own["members"][0]
    for lens in ("primary", "secondary", "late_shift", "weekends", "holidays"):
        assert mine[lens]["expected"] == row[lens]["expected"], f"{lens} expected differs"
        assert mine[lens]["deviation"] == row[lens]["deviation"], f"{lens} deviation differs"
    assert own["spreads"] == [], "member view must not expose the team spread"


def check_h02_departed_member_excluded_from_criterion() -> None:
    coordinator = Api("tomasz.krawczyk")
    team = require(coordinator.get("/api/v1/fairness"), "team fairness")
    baran = next((m for m in team["members"] if m["display_name"] == "Robert Baran"), None)
    assert baran is not None, "Robert Baran should still be listed (he has history)"
    assert baran["in_criterion"] is False, "a departed member must not count toward the criterion"


def check_h01_backdated_swap_is_refused() -> None:
    coordinator = Api("tomasz.krawczyk")
    calendar = require(
        coordinator.get(
            "/api/v1/calendar", params={"starts_on": "2026-09-01", "ends_on": "2026-09-10"}
        ),
        "calendar",
    )
    past = next(
        item
        for item in calendar["assignments"]
        if item["role"] in ("primary", "secondary") and item["assignee_name"] in NAME_TO_LOGIN
    )
    ids = member_ids(coordinator)
    other = next(name for name in NAME_TO_LOGIN if name != past["assignee_name"])
    requester = Api(NAME_TO_LOGIN[past["assignee_name"]])
    response = requester.post(
        "/api/v1/swaps",
        json={
            "schedule_id": past["schedule_id"],
            "service_date": past["service_date"],
            "role": past["role"],
            "replacement_member_id": ids[other],
            "note": "regression QA7-H01",
        },
    )
    assert response.status_code == 422, (
        f"expected 422, got {response.status_code}: {response.text[:300]}"
    )
    assert "już się odbył" in response.json()["detail"], response.text


def check_h08_login_throttles_after_repeated_failures() -> None:
    session = httpx.Client(base_url=BASE, timeout=30.0)
    last: httpx.Response | None = None
    for _ in range(8):
        last = session.post(
            "/api/v1/auth/login", json={"username": "ewa.maj", "password": "not-the-password"}
        )
        if last.status_code == 429:
            break
    assert last is not None and last.status_code == 429, (
        f"no throttle after 8 bad attempts: {last.status_code if last else 'no response'}"
    )
    assert "retry-after" in {key.lower() for key in last.headers}, "429 is missing Retry-After"


def _check_rules(schedule_id: str) -> str:
    result = subprocess.run(
        [sys.executable, str(Path(__file__).parent / "check_rules.py"), schedule_id],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    return result.stdout


def check_b03_and_h05_and_h07() -> dict[str, Any]:
    """Shares one fresh generation across three checks - it is the expensive
    part of this script, and all three read the same schedule.

    - B03: a solver-only schedule right after everything already published
      must not break the boundary rest rules.
    - H05: publishing across an unpublished stretch needs an explicit
      acknowledgement, not a silent gap (decision D6).
    - H07: a proxy for "one generation budget, not four" - a full
      reproduction of an unreachable criterion lives in
      `test_generation_time_budget.py`; this only guards the wall-clock
      order of magnitude for an ordinary generation.
    """
    coordinator = Api("tomasz.krawczyk")
    starts_on, ends_on = "2026-11-30", "2026-12-27"
    policy = require(coordinator.get("/api/v1/scheduling/policy"), "policy")
    budget = policy["solve_seconds"]

    started = time.monotonic()
    schedule = generate(coordinator, starts_on, ends_on, GENERATION_TIMEOUT)
    wall = time.monotonic() - started

    output = _check_rules(schedule["id"])
    errors_line = next(line for line in output.splitlines() if line.startswith("BŁĘDY:"))
    assert errors_line == "BŁĘDY: 0", f"boundary rest rules broken:\n{output}"

    proposed = require(
        coordinator.post(
            f"/api/v1/scheduling/{schedule['id']}/propose",
            json={"expected_version": schedule["version"]},
        ),
        "propose",
    )
    blocked = coordinator.post(
        f"/api/v1/scheduling/{schedule['id']}/publish",
        json={"expected_version": proposed["version"]},
    )
    assert blocked.status_code == 409, (
        f"expected 409, got {blocked.status_code}: {blocked.text[:300]}"
    )
    assert blocked.json()["detail"]["reason"] == "UNCOVERED_BEFORE", blocked.text

    published = require(
        coordinator.post(
            f"/api/v1/scheduling/{schedule['id']}/publish",
            json={
                "expected_version": proposed["version"],
                "acknowledge_gap": True,
                "acknowledge_rest_violations": True,
            },
        ),
        "publish after acknowledging the gap",
    )

    assert wall <= budget * 3, (
        f"generation took {wall:.1f}s for a {budget}s budget - looks like more than one pass"
    )
    return {"schedule": published, "starts_on": starts_on, "ends_on": ends_on}


def check_b02_and_h04(context: dict[str, Any]) -> None:
    """A direct override and a still-pending swap on a published schedule must
    both survive being reported (B02), and the pending request must be
    cancelled once a replacement schedule for the same range is published,
    not left orphaned (H04)."""
    coordinator = Api("tomasz.krawczyk")
    schedule = context["schedule"]
    starts_on, ends_on = context["starts_on"], context["ends_on"]
    ids = member_ids(coordinator)

    current = require(
        coordinator.get(f"/api/v1/scheduling/{schedule['id']}"), "reload published schedule"
    )
    override_day = starts_on
    on_call_that_day = {
        a["assignee_name"]
        for a in current["assignments"]
        if a["service_date"] == override_day and a["role"] in ("primary", "secondary")
    }
    # Neither the current primary nor whoever already holds secondary that day
    # - a person cannot hold both on-call roles at once.
    alternate = next(name for name in PRIMARY_CANDIDATES if name not in on_call_that_day)
    require(
        coordinator.post(
            "/api/v1/calendar/override",
            json={
                "schedule_id": schedule["id"],
                "expected_version": current["version"],
                "service_date": override_day,
                "role": "primary",
                "replacement_member_id": ids[alternate],
            },
        ),
        "apply override",
    )

    swap_day = str(date.fromisoformat(starts_on) + timedelta(days=3))
    day_calendar = require(
        coordinator.get("/api/v1/calendar", params={"starts_on": swap_day, "ends_on": swap_day}),
        "calendar for swap day",
    )
    swap_slot = next(a for a in day_calendar["assignments"] if a["role"] == "secondary")
    requester_name = swap_slot["assignee_name"]
    requester = Api(NAME_TO_LOGIN[requester_name])
    # Whoever `/swaps/options` actually offers - eligibility, availability and
    # existing on-call slots that day already rule out the obviously wrong
    # candidates, so there is no need to reason about them here too.
    options = require(
        requester.get(
            "/api/v1/swaps/options", params={"service_date": swap_day, "role": "secondary"}
        ),
        "swap options",
    )
    option = next(item for item in options if item["display_name"] in NAME_TO_LOGIN)
    other_name = option["display_name"]
    other_id = option["member_id"]
    created = require(
        requester.post(
            "/api/v1/swaps",
            json={
                "schedule_id": schedule["id"],
                "service_date": swap_day,
                "role": "secondary",
                "replacement_member_id": other_id,
                "note": "regression QA7-H04",
            },
        ),
        "create swap",
        201,
    )
    Api(NAME_TO_LOGIN[other_name]).post(f"/api/v1/swaps/{created['id']}/accept")
    # Left pending_coordinator on purpose - never approved.

    replacement = generate(coordinator, starts_on, ends_on, GENERATION_TIMEOUT)
    proposed = require(
        coordinator.post(
            f"/api/v1/scheduling/{replacement['id']}/propose",
            json={"expected_version": replacement["version"]},
        ),
        "propose replacement",
    )
    preview = require(
        coordinator.get(f"/api/v1/scheduling/{replacement['id']}/publish-preview"),
        "publish preview",
    )
    changed = len(preview.get("lost_changes", [])) + len(preview.get("carried_changes", []))
    assert changed >= 1, f"the override is not accounted for in the preview: {preview}"
    pending_ids = {item["id"] for item in preview.get("pending_swaps", [])}
    assert created["id"] in pending_ids, (
        f"the pending swap is not flagged for cancellation: {preview}"
    )

    resolutions = {
        f"{item['service_date']}:{item['role']}": "draft"
        for item in preview.get("lost_changes", [])
    }
    require(
        coordinator.post(
            f"/api/v1/scheduling/{replacement['id']}/publish",
            json={
                "expected_version": proposed["version"],
                "acknowledge_lost_changes": True,
                "acknowledge_gap": True,
                "acknowledge_rest_violations": True,
                "change_resolutions": resolutions,
            },
        ),
        "publish replacement",
    )

    cancelled = require(
        coordinator.get("/api/v1/swaps", params={"status": "cancelled", "limit": 50}),
        "cancelled swaps",
    )
    assert any(item["id"] == created["id"] for item in cancelled), (
        "the pending swap on a superseded schedule was not cancelled"
    )


def main() -> int:
    shared: dict[str, Any] = {}
    run("QA7-B01", check_b01_member_fairness_matches_coordinator_row)
    run("QA7-H02", check_h02_departed_member_excluded_from_criterion)
    run("QA7-H01", check_h01_backdated_swap_is_refused)
    run(
        "QA7-B03 / QA7-H05 / QA7-H07",
        lambda: shared.update(check_b03_and_h05_and_h07()),
    )
    if shared:
        run("QA7-B02 / QA7-H04", lambda: check_b02_and_h04(shared))
    else:
        FAILURES.append("QA7-B02 / QA7-H04")
        print("FAIL QA7-B02 / QA7-H04: skipped, its setup schedule was not generated")
    # Last on purpose: it deliberately trips the per-IP throttle (E1), which
    # would otherwise 429 every later scenario's own login from this runner.
    run("QA7-H08", check_h08_login_throttles_after_repeated_failures)

    print()
    if FAILURES:
        print(f"{len(FAILURES)} scenario(s) failed: {', '.join(FAILURES)}")
        return 1
    print("all scenarios OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
