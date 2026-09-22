import os

import pytest
from pydantic import ValidationError

from oncall.config import Settings, available_cpu_count


def test_cpu_count_uses_cgroup_v2_quota(tmp_path) -> None:
    (tmp_path / "cpu.max").write_text("200000 100000\n")

    assert available_cpu_count(tmp_path) == 2


def test_cpu_count_rounds_partial_cgroup_v2_cpu_up(tmp_path) -> None:
    (tmp_path / "cpu.max").write_text("150000 100000\n")

    assert available_cpu_count(tmp_path) == 2


def test_cpu_count_uses_cgroup_v1_quota(tmp_path) -> None:
    cpu = tmp_path / "cpu"
    cpu.mkdir()
    (cpu / "cpu.cfs_quota_us").write_text("300000\n")
    (cpu / "cpu.cfs_period_us").write_text("100000\n")

    assert available_cpu_count(tmp_path) == 3


def test_cpu_count_uses_affinity_without_a_cgroup_limit(tmp_path, monkeypatch) -> None:
    (tmp_path / "cpu.max").write_text("max 100000\n")
    monkeypatch.setattr(os, "sched_getaffinity", lambda _pid: set(range(6)))

    assert available_cpu_count(tmp_path) == 6


def test_cpu_count_is_limited_to_eight(tmp_path, monkeypatch) -> None:
    monkeypatch.setattr(os, "sched_getaffinity", lambda _pid: set(range(16)))

    assert available_cpu_count(tmp_path) == 8


def test_https_base_url_requires_a_secure_session_cookie() -> None:
    """#31/#36: an https deployment that forgot the Secure flag must not start,
    or it would keep serving the auth cookie over the pre-redirect cleartext
    request."""
    with pytest.raises(ValidationError, match="ONCALL_SESSION_COOKIE_SECURE"):
        Settings(public_base_url="https://oncall.example", session_cookie_secure=False)


def test_https_base_url_with_a_secure_cookie_is_accepted() -> None:
    settings = Settings(public_base_url="https://oncall.example", session_cookie_secure=True)
    assert settings.session_cookie_secure is True


def test_plain_http_deployment_may_keep_a_non_secure_cookie() -> None:
    settings = Settings(public_base_url="http://localhost:8080", session_cookie_secure=False)
    assert settings.session_cookie_secure is False
