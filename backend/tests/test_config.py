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


def test_cpu_count_of_an_unknown_machine_is_one(tmp_path, monkeypatch) -> None:
    def refused(_pid: int) -> set[int]:
        raise OSError("not permitted")

    monkeypatch.setattr(os, "sched_getaffinity", refused)
    monkeypatch.setattr(os, "cpu_count", lambda: None)

    assert available_cpu_count(tmp_path) == 1


@pytest.mark.parametrize("cpu_max", ["0 100000\n", "100000 0\n", "lots 100000\n", "max\n"])
def test_an_unusable_cgroup_v2_quota_falls_through_to_v1(tmp_path, cpu_max) -> None:
    (tmp_path / "cpu.max").write_text(cpu_max)
    cpu = tmp_path / "cpu"
    cpu.mkdir()
    (cpu / "cpu.cfs_quota_us").write_text("500000\n")
    (cpu / "cpu.cfs_period_us").write_text("100000\n")

    assert available_cpu_count(tmp_path) == 5


@pytest.mark.parametrize(
    ("quota", "period"), [("-1", "100000"), ("200000", "0"), ("200000", None), ("x", "100000")]
)
def test_an_unlimited_or_unreadable_cgroup_v1_quota_uses_the_affinity(
    tmp_path, monkeypatch, quota, period
) -> None:
    cpu = tmp_path / "cpu"
    cpu.mkdir()
    (cpu / "cpu.cfs_quota_us").write_text(quota)
    if period is not None:
        (cpu / "cpu.cfs_period_us").write_text(period)
    monkeypatch.setattr(os, "sched_getaffinity", lambda _pid: set(range(3)))

    assert available_cpu_count(tmp_path) == 3


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


def test_the_switch_url_is_read_from_its_own_variable(monkeypatch) -> None:
    """`ONCALL_SWITCH_URL`, not the doubled prefix the field name would give."""
    monkeypatch.setenv("ONCALL_SWITCH_URL", "https://centrala.example/przelacz")
    monkeypatch.setenv("ONCALL_ONCALL_SWITCH_URL", "https://wrong.example")

    assert Settings().oncall_switch_url == "https://centrala.example/przelacz"


def test_a_blank_switch_url_is_unset(monkeypatch) -> None:
    monkeypatch.delenv("ONCALL_SWITCH_URL", raising=False)

    assert Settings().oncall_switch_url is None
    assert Settings(oncall_switch_url="").oncall_switch_url is None
    assert Settings(oncall_switch_url="   ").oncall_switch_url is None
    assert Settings(oncall_switch_url=" HTTP://x.example/ ").oncall_switch_url == (
        "HTTP://x.example/"
    )


@pytest.mark.parametrize("url", ["javascript:alert(1)", "centrala.example", "ftp://x.example"])
def test_a_switch_url_must_be_a_web_address(url: str) -> None:
    with pytest.raises(ValidationError, match="ONCALL_SWITCH_URL"):
        Settings(oncall_switch_url=url)


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


@pytest.mark.parametrize("blank", ["", "   "], ids=["empty", "spaces"])
def test_blank_smtp_settings_are_unset(blank: str) -> None:
    """Compose passes an unset variable as "", and a stray space is no more a
    value: no host turns e-mail off, no local hostname leaves the EHLO name to
    the system, and no credentials send without logging in."""
    settings = Settings(
        smtp_host=blank, smtp_local_hostname=blank, smtp_username=blank, smtp_password=blank
    )

    assert settings.smtp_host is None
    assert settings.smtp_local_hostname is None
    assert settings.smtp_username is None
    assert settings.smtp_password is None


def test_smtp_hosts_are_trimmed_and_credentials_kept_as_written() -> None:
    settings = Settings(
        smtp_host=" smtp.example.com ",
        smtp_local_hostname=" oncall.internal.example.com ",
        smtp_username="oncall",
        smtp_password=" pass phrase ",
    )

    assert settings.smtp_host == "smtp.example.com"
    assert settings.smtp_local_hostname == "oncall.internal.example.com"
    assert settings.smtp_username == "oncall"
    assert settings.smtp_password == " pass phrase "


@pytest.mark.parametrize(
    ("username", "password"), [("oncall", None), ("oncall", " "), (None, "secret"), ("", "secret")]
)
def test_a_lone_smtp_credential_is_refused(username: str | None, password: str | None) -> None:
    """A username alone would log in with an empty password; a password alone
    would not log in at all and send unauthenticated from a deployment that
    meant to authenticate. Neither may start."""
    with pytest.raises(ValidationError, match="ONCALL_SMTP_USERNAME and ONCALL_SMTP_PASSWORD"):
        Settings(smtp_host="smtp.example.com", smtp_username=username, smtp_password=password)


def test_smtp_tls_and_starttls_are_refused_together() -> None:
    """aiosmtplib refuses the pair on every send, which would fail the outbox
    and the backup alert with nothing said at startup."""
    with pytest.raises(ValidationError, match="ONCALL_SMTP_STARTTLS=false"):
        Settings(smtp_use_tls=True, smtp_starttls=True)


@pytest.mark.parametrize(("use_tls", "starttls"), [(False, True), (True, False), (False, False)])
def test_each_smtp_transport_is_accepted(use_tls: bool, starttls: bool) -> None:
    settings = Settings(smtp_use_tls=use_tls, smtp_starttls=starttls)

    assert (settings.smtp_use_tls, settings.smtp_starttls) == (use_tls, starttls)


def test_a_refused_setting_does_not_echo_the_configuration(monkeypatch) -> None:
    """The error lands in the container log; it names the rule, never the
    values, which include every password in the environment."""
    monkeypatch.setenv("ONCALL_SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("ONCALL_SMTP_PASSWORD", "hunter2-do-not-log")

    with pytest.raises(ValidationError) as refused:
        Settings()

    assert "ONCALL_SMTP_USERNAME" in str(refused.value)
    assert "hunter2-do-not-log" not in str(refused.value)


@pytest.mark.parametrize("blank", ["", "   "], ids=["empty", "spaces"])
def test_blank_solver_workers_leaves_the_count_to_the_cpu_allocation(monkeypatch, blank) -> None:
    """Compose passes an unset ONCALL_SOLVER_WORKERS as an empty string."""
    monkeypatch.setenv("ONCALL_SOLVER_WORKERS", blank)

    assert Settings().solver_workers is None


def test_solver_workers_from_the_environment_is_the_count(monkeypatch) -> None:
    monkeypatch.setenv("ONCALL_SOLVER_WORKERS", "4")

    assert Settings().solver_workers == 4


def test_solver_workers_above_eight_is_refused(monkeypatch) -> None:
    monkeypatch.setenv("ONCALL_SOLVER_WORKERS", "9")

    with pytest.raises(ValidationError):
        Settings()
