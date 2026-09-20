"""Rebuild the QA7 database through the same interfaces used during the audit.

Usage (from the repository root):
    backend/.venv/bin/python docs/qa-suite-7/rebuild_state.py [--with-scenarios]
"""

from __future__ import annotations

import argparse
import subprocess
import sys
import time
from datetime import date
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).parent))

from api import Api

ROOT = Path(__file__).resolve().parents[2]
SUITE = Path(__file__).resolve().parent
TERMINAL_RUN_STATUSES = {"completed", "failed", "cancelled"}


def require(response: Any, label: str, *statuses: int) -> dict[str, Any]:
    allowed = statuses or tuple(range(200, 300))
    if response.status_code not in allowed:
        raise RuntimeError(
            f"{label}: HTTP {response.status_code}: {response.text[:800]}"
        )
    if response.status_code == 204:
        return {}
    return response.json()


def run_command(*command: str) -> None:
    print("+", " ".join(command), flush=True)
    subprocess.run(command, cwd=ROOT, check=True)


def seed_team() -> None:
    target = "/tmp/qa7-seed-team.py"
    run_command("docker", "compose", "cp", str(SUITE / "seed_team.py"), f"api:{target}")
    run_command("docker", "compose", "exec", "-T", "api", "python", target)


def import_history(api: Api) -> None:
    path = SUITE / "history-qa7.csv"
    with path.open("rb") as source:
        response = api.post(
            "/api/v1/history/preview",
            files={"file": (path.name, source, "text/csv")},
        )
    preview = require(response, "history preview")
    if not preview["valid"]:
        errors = "\n".join(str(item) for item in preview["errors"][:10])
        raise RuntimeError(
            f"history preview rejected {len(preview['errors'])} rows:\n{errors}"
        )
    committed = require(
        api.post(
            "/api/v1/history/commit",
            json={"filename": path.name, "rows": preview["rows"]},
        ),
        "history commit",
    )
    print(
        f"history: {len(preview['rows'])} rows, import {committed.get('id', 'created')}"
    )


def add_availability(login: str, starts_on: str, ends_on: str, note: str) -> None:
    member = Api(login)
    require(
        member.post(
            "/api/v1/availability/me",
            json={
                "kind": "unavailable",
                "starts_on": starts_on,
                "ends_on": ends_on,
                "note": note,
            },
        ),
        f"{login} availability {starts_on}..{ends_on}",
        201,
    )


def seed_availability() -> None:
    run_command(sys.executable, str(SUITE / "seed_availability.py"))
    add_availability("julia.nowak", "2026-10-05", "2026-10-12", "Nie mogę")


def set_policy(api: Api) -> None:
    require(
        api.put(
            "/api/v1/scheduling/policy",
            json={
                "rotation_mode": "hybrid",
                "late_shift_anchor": "secondary",
                "solve_seconds": 15,
                "fairness_weight": 3,
                "continuity_weight": 1,
                "preference_weight": 2,
            },
        ),
        "policy update",
    )


def generate(api: Api, starts_on: str, ends_on: str, timeout: float) -> dict[str, Any]:
    run = require(
        api.post(
            "/api/v1/scheduling/runs",
            json={"starts_on": starts_on, "ends_on": ends_on},
        ),
        f"queue generation {starts_on}..{ends_on}",
        202,
    )
    deadline = time.monotonic() + timeout
    last_status = None
    while time.monotonic() < deadline:
        run = require(
            api.get(f"/api/v1/scheduling/runs/{run['id']}"),
            f"poll generation {run['id']}",
        )
        if run["status"] != last_status:
            print(f"generation {run['id']}: {run['status']}", flush=True)
            last_status = run["status"]
        if run["status"] in TERMINAL_RUN_STATUSES:
            break
        time.sleep(1)
    else:
        raise RuntimeError(
            f"generation {run['id']} did not finish in {timeout:g} seconds"
        )
    if run["status"] != "completed" or not run.get("schedule_id"):
        raise RuntimeError(
            f"generation {run['id']} ended as {run['status']}: "
            f"{run.get('error') or run.get('conflicts')}"
        )
    return require(
        api.get(f"/api/v1/scheduling/{run['schedule_id']}"),
        f"load schedule {run['schedule_id']}",
    )


def publish(
    api: Api, schedule: dict[str, Any], *, expected_error: bool = False
) -> bool:
    proposed = require(
        api.post(
            f"/api/v1/scheduling/{schedule['id']}/propose",
            json={"expected_version": schedule["version"]},
        ),
        f"propose schedule {schedule['id']}",
    )
    # B1/B2 added confirmation gates (lost changes, an uncovered gap before the
    # range, rest violations) after this script was first written; a rebuild
    # deliberately recreates known-imperfect history (QA-REPORT-7's own
    # boundary cases), so it always acknowledges rather than exercising the
    # gates themselves - those have their own dedicated tests.
    response = api.post(
        f"/api/v1/scheduling/{schedule['id']}/publish",
        json={
            "expected_version": proposed["version"],
            "acknowledge_lost_changes": True,
            "acknowledge_gap": True,
            "acknowledge_rest_violations": True,
        },
    )
    if expected_error and 400 <= response.status_code < 500:
        print(
            f"expected error publishing {schedule['id']}: "
            f"{response.status_code} {response.text[:300]}"
        )
        return False
    require(response, f"publish schedule {schedule['id']}")
    return True


def member_ids(api: Api) -> dict[str, str]:
    report = require(api.get("/api/v1/fairness"), "load team member ids")
    return {item["display_name"]: item["member_id"] for item in report["members"]}


def override(
    api: Api,
    schedule: dict[str, Any],
    ids: dict[str, str],
    day: str,
    role: str,
    assignee: str,
) -> dict[str, Any]:
    return require(
        api.post(
            f"/api/v1/scheduling/{schedule['id']}/override",
            json={
                "expected_version": schedule["version"],
                "service_date": day,
                "role": role,
                "replacement_member_id": ids[assignee],
            },
        ),
        f"set {day} {role} to {assignee}",
    )


def safe_override(
    api: Api,
    schedule: dict[str, Any],
    ids: dict[str, str],
    day: str,
    role: str,
    assignee: str,
) -> dict[str, Any]:
    opposite = "secondary" if role == "primary" else "primary"
    target_opposite = next(
        item
        for item in schedule["assignments"]
        if item["service_date"] == day and item["role"] == opposite
    )
    if target_opposite["assignee_name"] == assignee:
        fallback = "Bartosz Kowal" if assignee == "Anna Wróbel" else "Anna Wróbel"
        schedule = override(api, schedule, ids, day, opposite, fallback)
    return override(api, schedule, ids, day, role, assignee)


def clear_oncall_near(
    api: Api,
    schedule: dict[str, Any],
    ids: dict[str, str],
    day: str,
    member_name: str,
) -> dict[str, Any]:
    """Keep a planned swap replacement free of neighbouring on-call duties."""
    target = date.fromisoformat(day)
    candidates = [
        name
        for name in ids
        if name not in {member_name, "Robert Baran"}
    ]
    for item in list(schedule["assignments"]):
        item_day = date.fromisoformat(item["service_date"])
        if (
            item["role"] not in {"primary", "secondary"}
            or item["assignee_name"] != member_name
            or abs((item_day - target).days) > 6
        ):
            continue
        opposite = "secondary" if item["role"] == "primary" else "primary"
        opposite_name = next(
            assignment["assignee_name"]
            for assignment in schedule["assignments"]
            if assignment["service_date"] == item["service_date"]
            and assignment["role"] == opposite
        )
        assignee = next(name for name in candidates if name != opposite_name)
        schedule = override(api, schedule, ids, item["service_date"], item["role"], assignee)
        candidates.append(candidates.pop(0))
    return schedule


def prepare_first_schedule(api: Api, schedule: dict[str, Any]) -> dict[str, Any]:
    ids = member_ids(api)
    for day, role, assignee in (
        ("2026-08-31", "primary", "Elżbieta Kaczmarek"),
        ("2026-08-31", "secondary", "Halina Szymańska"),
        ("2026-09-01", "primary", "Anna Wróbel"),
        ("2026-09-19", "secondary", "Tomasz Krawczyk"),
        ("2026-09-22", "primary", "Julia Nowak"),
        ("2026-09-26", "secondary", "Tomasz Krawczyk"),
    ):
        schedule = safe_override(api, schedule, ids, day, role, assignee)
    return schedule


def assignment(
    schedule: dict[str, Any], day: str, owner: str, role: str | None
) -> dict[str, Any]:
    matches = [
        item
        for item in schedule["assignments"]
        if item["service_date"] == day
        and item["assignee_name"] == owner
        and (role is None or item["role"] == role)
        and item["role"] in {"primary", "secondary"}
    ]
    if not matches:
        raise RuntimeError(f"{owner} does not own requested on-call slot on {day}")
    return matches[0]


def replacement_id(requester: Api, day: str, role: str, name: str) -> str:
    options = require(
        requester.get(
            "/api/v1/swaps/options", params={"service_date": day, "role": role}
        ),
        f"swap options for {day} {role}",
    )
    option = next((item for item in options if item["display_name"] == name), None)
    if option is None:
        raise RuntimeError(f"{name} is not a replacement option for {day} {role}")
    return option["member_id"]


def swap(
    schedule: dict[str, Any],
    day: str,
    role: str | None,
    requester_login: str,
    requester_name: str,
    replacement_login: str,
    replacement_name: str,
    *,
    approve: bool = True,
    expected_error: bool = False,
) -> str | None:
    try:
        slot = assignment(schedule, day, requester_name, role)
        requester = Api(requester_login)
        replacement = Api(replacement_login)
        coordinator = Api("ewa.maj")
        replacement_member_id = replacement_id(
            requester, day, slot["role"], replacement_name
        )
        created = require(
            requester.post(
                "/api/v1/swaps",
                json={
                    "schedule_id": schedule["id"],
                    "service_date": day,
                    "role": slot["role"],
                    "replacement_member_id": replacement_member_id,
                    "note": "Scenariusz odtworzenia QA7",
                },
            ),
            f"create swap {day}",
            201,
        )
        accepted = require(
            replacement.post(f"/api/v1/swaps/{created['id']}/accept"),
            f"accept swap {created['id']}",
        )
        if approve:
            require(
                coordinator.post(f"/api/v1/swaps/{accepted['id']}/approve"),
                f"approve swap {accepted['id']}",
            )
        print(
            f"swap {day} {slot['role']}: {requester_name} -> {replacement_name} ({created['id']})"
        )
        return created["id"]
    except RuntimeError as error:
        if expected_error:
            print(f"expected scenario error: {error}")
            return None
        raise


def scenarios(api: Api, first: dict[str, Any], timeout: float) -> list[str]:
    add_availability("julia.nowak", "2026-09-22", "2026-09-22", "Nie mogę")
    for args in (
        (
            "2026-09-22",
            None,
            "julia.nowak",
            "Julia Nowak",
            "bartosz.kowal",
            "Bartosz Kowal",
        ),
        (
            "2026-09-19",
            None,
            "tomasz.krawczyk",
            "Tomasz Krawczyk",
            "bartosz.kowal",
            "Bartosz Kowal",
        ),
        (
            "2026-09-26",
            "secondary",
            "tomasz.krawczyk",
            "Tomasz Krawczyk",
            "anna.wrobel",
            "Anna Wróbel",
        ),
        (
            "2026-09-01",
            "primary",
            "anna.wrobel",
            "Anna Wróbel",
            "bartosz.kowal",
            "Bartosz Kowal",
        ),
    ):
        swap(first, *args, expected_error=True)

    october = generate(api, "2026-09-28", "2026-10-25", timeout)
    november = generate(api, "2026-10-26", "2026-11-29", timeout)
    ids = member_ids(api)
    november = safe_override(api, november, ids, "2026-11-03", "primary", "Julia Nowak")
    november = safe_override(
        api, november, ids, "2026-11-05", "primary", "Celina Mazur"
    )
    november = clear_oncall_near(
        api, november, ids, "2026-11-03", "Anna Wróbel"
    )
    november = clear_oncall_near(
        api, november, ids, "2026-11-05", "Bartosz Kowal"
    )
    publish(api, november)
    published_november = require(
        api.get(f"/api/v1/scheduling/{november['id']}"), "reload published November"
    )
    swap(
        published_november,
        "2026-11-03",
        "primary",
        "julia.nowak",
        "Julia Nowak",
        "anna.wrobel",
        "Anna Wróbel",
    )
    swap(
        published_november,
        "2026-11-05",
        None,
        "celina.mazur",
        "Celina Mazur",
        "bartosz.kowal",
        "Bartosz Kowal",
        approve=False,
    )
    replacement = generate(api, "2026-10-26", "2026-11-29", timeout)
    publish(api, replacement, expected_error=True)
    return [october["id"], november["id"], replacement["id"]]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--with-scenarios", action="store_true")
    parser.add_argument("--generation-timeout", type=float, default=300)
    args = parser.parse_args()

    seed_team()
    coordinator = Api("tomasz.krawczyk")
    import_history(coordinator)
    seed_availability()
    set_policy(coordinator)
    first = generate(coordinator, "2026-08-31", "2026-09-27", args.generation_timeout)
    first = prepare_first_schedule(coordinator, first)
    publish(coordinator, first)
    schedule_ids = [first["id"]]
    if args.with_scenarios:
        schedule_ids.extend(scenarios(coordinator, first, args.generation_timeout))
    print("schedule ids:")
    for schedule_id in schedule_ids:
        print(f"  {schedule_id}")


if __name__ == "__main__":
    main()
