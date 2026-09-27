"""#34: the admin bootstrap must refuse the .env.example placeholder and other
obvious defaults, which are long enough to slip past the length check alone."""

import pytest
from httpx import AsyncClient

from oncall import seed_admin as seed_admin_module
from oncall.seed_admin import seed_admin


async def test_rejects_the_env_example_placeholder(monkeypatch) -> None:
    monkeypatch.setenv("ONCALL_ADMIN_USERNAME", "admin")
    monkeypatch.setenv("ONCALL_ADMIN_PASSWORD", "replace-with-at-least-12-characters")
    with pytest.raises(SystemExit, match="placeholder or an obvious default"):
        await seed_admin()


async def test_rejects_an_obvious_default_regardless_of_case(monkeypatch) -> None:
    monkeypatch.setenv("ONCALL_ADMIN_USERNAME", "admin")
    monkeypatch.setenv("ONCALL_ADMIN_PASSWORD", "Password1234")
    with pytest.raises(SystemExit, match="placeholder or an obvious default"):
        await seed_admin()


async def test_still_requires_twelve_characters(monkeypatch) -> None:
    monkeypatch.setenv("ONCALL_ADMIN_USERNAME", "admin")
    monkeypatch.setenv("ONCALL_ADMIN_PASSWORD", "short")
    with pytest.raises(SystemExit, match="minimum 12 characters"):
        await seed_admin()


async def test_skips_quietly_when_no_credentials_are_configured(monkeypatch, capsys) -> None:
    monkeypatch.delenv("ONCALL_ADMIN_USERNAME", raising=False)
    monkeypatch.delenv("ONCALL_ADMIN_PASSWORD", raising=False)
    await seed_admin()
    assert "Admin bootstrap skipped" in capsys.readouterr().out


async def test_a_mixed_case_username_is_stored_the_way_sign_in_looks_it_up(
    monkeypatch, client: AsyncClient, db_factory
) -> None:
    monkeypatch.setattr(seed_admin_module, "SessionFactory", db_factory)
    monkeypatch.setenv("ONCALL_ADMIN_USERNAME", " Admin.Kowalski ")
    monkeypatch.setenv("ONCALL_ADMIN_PASSWORD", "a-real-admin-passphrase")

    await seed_admin()
    await seed_admin()

    response = await client.post(
        "/api/v1/auth/login",
        json={"username": "ADMIN.kowalski", "password": "a-real-admin-passphrase"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["username"] == "admin.kowalski"
