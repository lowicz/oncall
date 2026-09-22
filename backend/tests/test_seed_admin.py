"""#34: the admin bootstrap must refuse the .env.example placeholder and other
obvious defaults, which are long enough to slip past the length check alone."""

import pytest

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
