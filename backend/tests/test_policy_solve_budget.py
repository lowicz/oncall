"""Budżet czasu solvera jako pole polityki (MED5-02, HGH5-01).

Komunikat `UNKNOWN` odsyłał użytkownika słowami „zwiększ budżet czasu w
ustawieniach generowania" do kontrolki, która nie istniała.
"""

import importlib.util
from pathlib import Path

import pytest

from oncall.config import Settings
from oncall.domain.vocabulary import UserRole
from oncall.infrastructure.sqlalchemy.scheduling_models import DEFAULT_SOLVE_SECONDS
from oncall.policy import load_policy
from oncall.scheduler import SOLVE_SECONDS
from tests.conftest import create_user, login

REPOSITORY = Path(__file__).resolve().parents[2]


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


def test_the_migrated_policy_row_starts_at_the_default_budget() -> None:
    """Migracje tworzą wiersz polityki, więc na wdrożonej bazie budżet zaczyna
    od wartości domyślnej kolumny, a nie od zmiennej środowiskowej."""
    path = REPOSITORY / "backend" / "migrations" / "versions" / "0025_policy_solve_seconds.py"
    spec = importlib.util.spec_from_file_location("policy_solve_seconds", path)
    assert spec is not None and spec.loader is not None
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)

    assert float(migration.DEFAULT_SOLVE_SECONDS) == DEFAULT_SOLVE_SECONDS


def test_solver_seconds_is_no_longer_a_setting(monkeypatch) -> None:
    """#61: `ONCALL_SOLVER_SECONDS` nigdy nie docierało do budżetu, bo wiersz
    polityki tworzy migracja. Zmienna zniknęła z kontraktu; `.env`, który
    wciąż ją ustawia, uruchamia się i niczego nie zmienia."""
    monkeypatch.setenv("ONCALL_SOLVER_SECONDS", "10")

    settings = Settings()

    assert "solver_seconds" not in Settings.model_fields
    assert not hasattr(settings, "solver_seconds")


async def test_only_the_policy_sets_the_budget(db, monkeypatch) -> None:
    monkeypatch.setenv("ONCALL_SOLVER_SECONDS", "10")

    created = await load_policy(db)
    assert created.solve_seconds == DEFAULT_SOLVE_SECONDS

    created.solve_seconds = 45
    await db.commit()
    db.expunge_all()
    assert (await load_policy(db)).solve_seconds == 45


def test_the_operator_contract_does_not_promise_solver_seconds() -> None:
    """Budżet ustawia się wyłącznie w „Ustawieniach generatora”; ani `.env`,
    ani Compose, ani dokumentacja nie obiecują już zmiennej środowiskowej."""
    operator_files = [
        REPOSITORY / ".env.example",
        REPOSITORY / "README.md",
        *REPOSITORY.glob("docker-compose*.yml"),
        *(REPOSITORY / "docs").rglob("*.md"),
    ]

    promising = [
        str(path.relative_to(REPOSITORY))
        for path in operator_files
        if "ONCALL_SOLVER_SECONDS" in path.read_text(encoding="utf-8")
    ]

    assert promising == []
