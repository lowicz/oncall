"""#34: the admin bootstrap must refuse the .env.example placeholder and other
obvious defaults, which are long enough to slip past the length check alone."""

import asyncio
import runpy
import sys

import pytest
from httpx import AsyncClient
from sqlalchemy import select, update

from oncall import seed_admin as seed_admin_module
from oncall.domain.vocabulary import UserRole
from oncall.infrastructure.sqlalchemy.access_models import User
from oncall.seed_admin import seed_admin
from tests.conftest import create_user


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


@pytest.mark.parametrize(
    ("username", "password"), [("admin", None), (None, "a-real-admin-passphrase")]
)
async def test_one_credential_without_the_other_stops_the_bootstrap(
    monkeypatch, username, password
) -> None:
    for name, value in (("ONCALL_ADMIN_USERNAME", username), ("ONCALL_ADMIN_PASSWORD", password)):
        if value is None:
            monkeypatch.delenv(name, raising=False)
        else:
            monkeypatch.setenv(name, value)

    with pytest.raises(SystemExit, match="Set both"):
        await seed_admin()


async def test_an_existing_account_is_restored_to_the_configured_admin(
    monkeypatch, db, db_factory, client: AsyncClient, capsys
) -> None:
    """The environment is authoritative: an account under the admin's login
    that was demoted, deactivated or given another password is put back."""
    await create_user(db, "szef", role=UserRole.viewer, display_name="Stara nazwa")
    await db.execute(update(User).where(User.username == "szef").values(is_active=False))
    await db.commit()
    monkeypatch.setattr(seed_admin_module, "SessionFactory", db_factory)
    monkeypatch.setenv("ONCALL_ADMIN_USERNAME", "szef")
    monkeypatch.setenv("ONCALL_ADMIN_PASSWORD", "a-rotated-admin-passphrase")
    monkeypatch.setenv("ONCALL_ADMIN_DISPLAY_NAME", "Szef Zmiany")

    await seed_admin()

    assert "Synchronized environment-managed admin user 'szef'." in capsys.readouterr().out
    async with db_factory() as reader:
        stored = await reader.scalar(select(User).where(User.username == "szef"))
    assert stored is not None
    assert (stored.role, stored.is_active, stored.display_name) == (
        UserRole.admin,
        True,
        "Szef Zmiany",
    )
    signed_in = await client.post(
        "/api/v1/auth/login", json={"username": "szef", "password": "a-rotated-admin-passphrase"}
    )
    assert signed_in.status_code == 200, signed_in.text


def test_running_the_module_bootstraps_the_admin(monkeypatch) -> None:
    """`python -m oncall.seed_admin` is what the container runs on start."""
    started: list[str] = []

    def fake_run(coroutine) -> None:
        started.append(coroutine.cr_code.co_name)
        coroutine.close()

    monkeypatch.setattr(asyncio, "run", fake_run)
    monkeypatch.delitem(sys.modules, "oncall.seed_admin")

    runpy.run_module("oncall.seed_admin", run_name="__main__")

    assert started == ["seed_admin"]
