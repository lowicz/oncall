import os
from functools import lru_cache
from math import ceil
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

CGROUP_ROOT = Path("/sys/fs/cgroup")


def _read_int(path: Path) -> int | None:
    try:
        return int(path.read_text().strip())
    except OSError, ValueError:
        return None


def available_cpu_count(cgroup_root: Path = CGROUP_ROOT) -> int:
    """Return the CPU allocation visible through cgroups or affinity.

    Docker's CPU quota is not reflected by ``os.cpu_count()``. Prefer the v2
    quota, then the v1 quota, and use the process affinity when neither cgroup
    exposes a finite limit. CP-SAT is deliberately capped at eight workers.
    """
    try:
        quota_text, period_text = (cgroup_root / "cpu.max").read_text().split()[:2]
        if quota_text != "max":
            quota, period = int(quota_text), int(period_text)
            if quota > 0 and period > 0:
                return max(1, min(8, ceil(quota / period)))
    except OSError, ValueError:
        pass

    quota = _read_int(cgroup_root / "cpu" / "cpu.cfs_quota_us")
    period = _read_int(cgroup_root / "cpu" / "cpu.cfs_period_us")
    if quota is not None and period is not None and quota > 0 and period > 0:
        return max(1, min(8, ceil(quota / period)))

    try:
        detected = len(os.sched_getaffinity(0))
    except AttributeError, OSError:
        detected = os.cpu_count() or 1
    return max(1, min(8, detected))


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="ONCALL_", extra="ignore")

    #: Product name shown in the interface, e-mails and calendar names. The
    #: subtitle is the optional second line under the name in the rail and on
    #: the login screen; empty hides it. Both are deployment settings so the
    #: public repository carries no organisation name.
    app_name: str = "On-call"
    app_subtitle: str = ""
    environment: str = "development"
    database_url: str = "postgresql+asyncpg://oncall:oncall@localhost:5432/oncall"
    database_pool_size: int = Field(default=3, ge=1, le=20)
    database_max_overflow: int = Field(default=2, ge=0, le=20)
    effective_assignments_cache_seconds: float = Field(default=1.0, ge=0, le=5)
    session_cookie_name: str = "oncall_session"
    session_cookie_secure: bool = False
    session_ttl_hours: int = 12
    cors_origins: list[str] = ["http://localhost:5173"]

    # Optional Active Directory / LDAP authentication. Local accounts remain
    # available regardless of this switch or the directory's availability.
    ldap_enabled: bool = False
    ldap_server_uri: str | None = None
    ldap_bind_dn: str | None = None
    ldap_bind_password: str | None = None
    ldap_base_dn: str | None = None
    ldap_user_filter: str | None = None
    ldap_start_tls: bool = True
    #: PEM bundle of the CAs that sign the directory's certificate, for an
    #: enterprise CA the image does not trust. Unset, the image's public roots
    #: decide.
    ldap_ca_file: str | None = None
    ldap_connect_timeout_seconds: float = Field(default=5.0, gt=0, le=60)
    ldap_attribute_personnel_number: str = "employeeNumber"
    ldap_attribute_first_name: str = "givenName"
    ldap_attribute_last_name: str = "sn"
    ldap_attribute_email: str = "mail"

    # External SMTP service. Not hosted by this project; when smtp_host is
    # unset, e-mail notifications are marked as skipped instead of sent.
    smtp_host: str | None = None
    smtp_port: int = 587
    smtp_username: str | None = None
    smtp_password: str | None = None
    # FQDN sent in EHLO/HELO; some SMTP servers require a specific client name.
    smtp_local_hostname: str | None = None
    smtp_use_tls: bool = False
    smtp_starttls: bool = True
    email_from: str = "On-call <oncall@example.com>"

    public_base_url: str = "http://localhost:8080"
    share_link_max_days: int = 30

    worker_poll_seconds: float = 5.0
    worker_batch_size: int = 20
    #: How often an idle generation lane checks for a queued run. Kept short so
    #: a freshly queued generation starts promptly; a lane that just finished a
    #: run re-checks with no delay.
    generation_poll_seconds: float = 1.0
    #: Generation lanes running in parallel in the worker. Default 1 is
    #: deliberate: with two CPUs allocated, two solvers running side by side are
    #: slower than the same two run back to back. Raise it only when the
    #: worker has cores to spare.
    generation_concurrency: int = Field(default=1, ge=1, le=4)
    #: How long a run may sit in `running` without its progress loop touching
    #: the row before another worker declares it abandoned. The loop touches
    #: the row once per second, so this is a margin for a stalled event loop or
    #: a slow database, not a bound on the solve: a healthy generation keeps
    #: beating however long it takes.
    stale_run_seconds: float = Field(default=120.0, ge=10, le=3600)
    solver_workers: int = Field(default=available_cpu_count(), ge=1, le=8)
    #: Seeds the policy row's budget on first use; afterwards the policy field
    #: owns it and this variable is no longer read.
    solver_seconds: float = Field(default=15.0, gt=0, le=300)
    solver_log: bool = False
    notification_max_attempts: int = 5
    #: How long a worker's claim on an outbox row holds before the row becomes
    #: eligible again. Must comfortably exceed one provider call: it is what
    #: keeps a second worker off a message that is mid-flight, and what gets
    #: the message delivered anyway if the worker holding it dies.
    notification_lease_seconds: float = Field(default=300.0, ge=30, le=3600)
    handover_reminder_hour: int = 9  # Europe/Warsaw local time
    #: How often the worker reports how much work is waiting. The sample is one
    #: indexed read per queue and it is emitted whether or not anything is
    #: happening: a heartbeat that stops is the cheapest sign that the worker
    #: has, and a minute of silence is the most an operator has to wait to see
    #: it.
    metrics_interval_seconds: float = Field(default=60.0, ge=5, le=3600)


@lru_cache
def get_settings() -> Settings:
    return Settings()
