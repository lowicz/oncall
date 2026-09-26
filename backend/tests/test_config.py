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


def test_version_comes_from_the_image_environment(monkeypatch) -> None:
    """release.yml bakes the tag into the image as ONCALL_VERSION; that is the
    version the interface shows."""
    monkeypatch.setenv("ONCALL_VERSION", "1.4.0")

    assert Settings().version == "1.4.0"


def test_version_defaults_to_dev_for_a_checkout_build(monkeypatch) -> None:
    monkeypatch.delenv("ONCALL_VERSION", raising=False)

    assert Settings().version == "dev"


def test_blank_or_padded_version_is_normalised() -> None:
    assert Settings(version="").version == "dev"
    assert Settings(version="   ").version == "dev"
    assert Settings(version=" 1.4.0 ").version == "1.4.0"


def test_retention_defaults_are_the_accepted_ages() -> None:
    """A deployment that sets nothing keeps business audit a year, sign-ins
    and the outbox a quarter, finished runs a month, and prunes hourly."""
    settings = Settings()

    assert (
        settings.retention_audit_days,
        settings.retention_login_audit_days,
        settings.retention_outbox_days,
        settings.retention_runs_days,
    ) == (365, 90, 90, 30)
    assert settings.retention_interval_seconds == 3600
    assert (settings.retention_batch_size, settings.retention_max_batches) == (1000, 20)


def test_retention_ages_are_days_zero_or_more(monkeypatch) -> None:
    """0 keeps a table for ever; a negative age has no meaning, and a sub-day
    sign-in age cannot be expressed, which keeps the five-minute login
    throttle window safe without a special rule."""
    monkeypatch.setenv("ONCALL_RETENTION_AUDIT_DAYS", "0")
    assert Settings().retention_audit_days == 0

    with pytest.raises(ValidationError, match="retention_login_audit_days"):
        Settings(retention_login_audit_days=-1)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("retention_interval_seconds", 59),
        ("retention_interval_seconds", 86401),
        ("retention_batch_size", 99),
        ("retention_batch_size", 10001),
        ("retention_max_batches", 0),
        ("retention_max_batches", 1001),
    ],
)
def test_retention_rhythm_is_bounded(field: str, value: int) -> None:
    with pytest.raises(ValidationError, match=field):
        Settings(**{field: value})
