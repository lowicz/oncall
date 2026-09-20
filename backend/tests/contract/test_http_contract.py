import json
from datetime import date
from pathlib import Path

from oncall.main import app
from oncall.models import RotationMode
from oncall.scheduler import generate_schedule
from tests.test_scheduler import member

OPENAPI_SNAPSHOT = Path(__file__).resolve().parents[2] / "contracts" / "openapi.json"


def _canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def test_openapi_matches_approved_snapshot() -> None:
    assert _canonical(app.openapi()) == OPENAPI_SNAPSHOT.read_text(), (
        "Public API contract changed. Inspect the OpenAPI diff and update the snapshot only "
        "when the change was explicitly approved."
    )


async def test_public_response_and_validation_envelopes(client) -> None:
    health = await client.get("/api/v1/health")
    assert (health.status_code, health.json()) == (200, {"status": "ok"})

    config = await client.get("/api/v1/config")
    assert (config.status_code, config.json()) == (
        200,
        {"ldap_enabled": False, "app_name": "On-call", "app_subtitle": ""},
    )

    invalid = await client.post(
        "/api/v1/auth/login",
        json={"username": "", "password": "short"},
    )
    assert (invalid.status_code, invalid.json()) == (
        422,
        {
            "detail": [
                {
                    "loc": ["body", "username"],
                    "msg": "Wartość jest za krótka (minimum 1 znaków).",
                    "type": "string_too_short",
                },
                {
                    "loc": ["body", "password"],
                    "msg": "Wartość jest za krótka (minimum 8 znaków).",
                    "type": "string_too_short",
                },
            ]
        },
    )


async def test_login_cookie_and_csrf_contract(client, db) -> None:
    from oncall.models import UserRole
    from tests.conftest import create_user

    await create_user(db, "kontrakt", role=UserRole.member, display_name="Jan Kontrakt")
    response = await client.post(
        "/api/v1/auth/login",
        json={"username": " KONTRAKT ", "password": "test-password-123"},
    )

    assert response.status_code == 200
    assert response.json() == {
        "username": "kontrakt",
        "display_name": "Jan Kontrakt",
        "role": "member",
        "has_team_member": False,
        "email": None,
        "phone": None,
        "share": None,
    }
    assert len(response.headers["x-csrf-token"]) == 43
    cookie = response.headers["set-cookie"]
    assert "oncall_session=" in cookie
    assert "HttpOnly" in cookie
    assert "Path=/" in cookie
    assert "SameSite=lax" in cookie


def test_fixed_input_solver_result_is_exactly_stable() -> None:
    """D-04: architecture work may not merely preserve feasibility."""
    result = generate_schedule(
        starts_on=date(2026, 9, 7),
        ends_on=date(2026, 9, 9),
        mode=RotationMode.daily,
        members=[member(name) for name in ("Anna", "Marek", "Ola", "Piotr")],
        historical_points={},
        holidays=set(),
        solver_workers=1,
        solve_seconds=15,
    )

    assert {
        "status": result.status,
        "warnings": result.warnings,
        "acceptance_floor": result.acceptance_floor,
        "fairness_proven": result.fairness_proven,
        "continuity_gap": result.continuity_gap,
        "assignments": [
            (item.service_date.isoformat(), item.role.value, item.assignee_name)
            for item in result.assignments
        ],
    } == {
        "status": "OPTIMAL",
        "warnings": (),
        "acceptance_floor": None,
        "fairness_proven": True,
        "continuity_gap": 0.0,
        "assignments": [
            ("2026-09-07", "late_shift", "Ola"),
            ("2026-09-07", "primary", "Anna"),
            ("2026-09-07", "secondary", "Ola"),
            ("2026-09-08", "late_shift", "Marek"),
            ("2026-09-08", "primary", "Ola"),
            ("2026-09-08", "secondary", "Marek"),
            ("2026-09-09", "late_shift", "Piotr"),
            ("2026-09-09", "primary", "Marek"),
            ("2026-09-09", "secondary", "Piotr"),
        ],
    }
