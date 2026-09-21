"""Budżet czasu solvera jako pole polityki (MED5-02, HGH5-01).

Komunikat `UNKNOWN` odsyłał użytkownika słowami „zwiększ budżet czasu w
ustawieniach generowania" do kontrolki, która nie istniała.
"""

import pytest

from oncall.domain.vocabulary import UserRole
from oncall.infrastructure.sqlalchemy.scheduling_models import DEFAULT_SOLVE_SECONDS
from oncall.scheduler import SOLVE_SECONDS
from tests.conftest import create_user, login


def test_the_policy_default_equals_the_solver_default() -> None:
    """Dwa źródła tej samej liczby muszą się zgadzać, inaczej szkic
    wygenerowany przez workera i opis w dokumentacji się rozjadą."""
    assert DEFAULT_SOLVE_SECONDS == SOLVE_SECONDS


async def test_policy_exposes_and_accepts_the_budget(client, db) -> None:
    await create_user(db, "koord.budget", role=UserRole.coordinator)
    await login(client, "koord.budget")

    current = await client.get("/api/v1/scheduling/policy")
    assert current.status_code == 200, current.text
    assert current.json()["solve_seconds"] == DEFAULT_SOLVE_SECONDS

    saved = await client.put(
        "/api/v1/scheduling/policy",
        json={"rotation_mode": "hybrid", "solve_seconds": 45},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["solve_seconds"] == 45
    assert (await client.get("/api/v1/scheduling/policy")).json()["solve_seconds"] == 45


@pytest.mark.parametrize("value", [4, 301, 0])
async def test_policy_rejects_a_budget_outside_the_supported_range(client, db, value: int) -> None:
    await create_user(db, "koord.budget", role=UserRole.coordinator)
    await login(client, "koord.budget")
    response = await client.put(
        "/api/v1/scheduling/policy",
        json={"rotation_mode": "hybrid", "solve_seconds": value},
    )
    assert response.status_code == 422, response.text


async def test_the_run_reports_the_budget_the_policy_holds(client, db) -> None:
    await create_user(db, "koord.budget", role=UserRole.coordinator)
    await login(client, "koord.budget")
    await client.put(
        "/api/v1/scheduling/policy", json={"rotation_mode": "hybrid", "solve_seconds": 25}
    )
    queued = await client.post(
        "/api/v1/scheduling/runs",
        json={"starts_on": "2027-06-01", "ends_on": "2027-06-14"},
    )
    assert queued.status_code == 202, queued.text
    assert queued.json()["solve_seconds"] == 25
