import os
from functools import lru_cache
from math import ceil
from pathlib import Path
from typing import Self

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

CGROUP_ROOT = Path("/sys/fs/cgroup")

#: What a build from a checkout calls itself; only a release image knows better.
DEV_VERSION = "dev"


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
    #: A refused setting names the variable and the rule but never echoes the
    #: input: that is every ONCALL_* value, passwords included, and it would
    #: land in the container log.
    model_config = SettingsConfigDict(
        env_file=".env", env_prefix="ONCALL_", extra="ignore", hide_input_in_errors=True
    )

    #: Product name shown in the interface, e-mails and calendar names. The
    #: subtitle is the optional second line under the name in the rail and on
    #: the login screen; empty hides it. Both are deployment settings so the
    #: public repository carries no organisation name.
    app_name: str = "On-call"
    app_subtitle: str = ""
    #: The release this process runs, shown in the interface. The image bakes
    #: in the git tag it was built from (backend/Dockerfile, ARG ONCALL_VERSION
    #: from release.yml), so this names what really runs even when the host's
    #: ONCALL_VERSION in .env is a floating tag such as `1.2`; Compose passes
    #: no ONCALL_VERSION to the containers on purpose. A checkout build has no
    #: tag and says `dev`.
    version: str = DEV_VERSION
    database_url: str = "postgresql+asyncpg://oncall:oncall@localhost:5432/oncall"
    database_pool_size: int = Field(default=3, ge=1, le=20)
    database_max_overflow: int = Field(default=2, ge=0, le=20)
    effective_assignments_cache_seconds: float = Field(default=1.0, ge=0, le=5)
    session_cookie_name: str = "oncall_session"
    session_cookie_secure: bool = False
    session_ttl_hours: int = 12
    #: The application is served same-origin behind nginx, so the browser never
    #: makes a cross-origin API call in production and the allow-list is only
    #: the deployment's own origin. A developer running the Vite server directly
    #: (not through its `/api` proxy) adds `http://localhost:5173`.
    cors_origins: list[str] = ["http://localhost:8080"]
    #: Networks whose `X-Real-IP` is trusted for the per-IP login throttle and
    #: the security log. The shipped nginx reaches the API over a private
    #: container network and overwrites `X-Real-IP` with the real peer
    #: (`$remote_addr`), so the loopback and private ranges are trusted by
    #: default and a remote client cannot forge its throttle bucket even if the
    #: API port is published by mistake. Tighten this to the proxy's own address
    #: when the API is deliberately exposed without nginx in front.
    trusted_proxies: list[str] = [
        "127.0.0.0/8",
        "::1/128",
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "fc00::/7",
    ]

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
    #: The person's photo, shown as their avatar in the interface. Active
    #: Directory keeps a small JPEG in `thumbnailPhoto` (what Outlook and
    #: Teams show); an inetOrgPerson directory keeps one in `jpegPhoto`. Read
    #: on demand for the signed-in person only and never stored; empty turns
    #: the photo off, so the service account then needs no right to read it.
    ldap_attribute_photo: str = "thumbnailPhoto"

    # External SMTP service. Not hosted by this project; when smtp_host is
    # unset, e-mail notifications are marked as skipped instead of sent.
    smtp_host: str | None = None
    smtp_port: int = 587
    #: Both set, the application logs in (SMTP AUTH) before it sends; both
    #: unset, it sends without logging in, to a relay that decides by the
    #: client's EHLO name or address whether it may. One without the other
    #: is refused at startup.
    smtp_username: str | None = None
    smtp_password: str | None = None
    # FQDN sent in EHLO/HELO; some SMTP servers require a specific client name.
    smtp_local_hostname: str | None = None
    #: TLS from the first byte (usually port 465) or a STARTTLS upgrade of a
    #: plain connection (587); both off is a plain connection (25). Both on
    #: is refused at startup.
    smtp_use_tls: bool = False
    smtp_starttls: bool = True
    email_from: str = "On-call <oncall@example.com>"

    public_base_url: str = "http://localhost:8080"

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
    solver_log: bool = False
    notification_max_attempts: int = 5
    #: How long a worker's claim on an outbox row holds before the row becomes
    #: eligible again. Must comfortably exceed one provider call: it is what
    #: keeps a second worker off a message that is mid-flight, and what gets
    #: the message delivered anyway if the worker holding it dies.
    notification_lease_seconds: float = Field(default=300.0, ge=30, le=3600)
    handover_reminder_hour: int = 9  # Europe/Warsaw local time
    #: The page the team switches the on-call number on. The notice on the
    #: first day of a PRIMARY segment links to it; unset or empty, that notice
    #: asks for the switch without a link. The page is outside this application,
    #: so there is no default. Read from `ONCALL_SWITCH_URL`: the alias keeps
    #: the prefix from being written twice.
    oncall_switch_url: str | None = Field(default=None, validation_alias="oncall_switch_url")
    #: How often the worker reports how much work is waiting. The sample is one
    #: indexed read per queue and it is emitted whether or not anything is
    #: happening: a heartbeat that stops is the cheapest sign that the worker
    #: has, and a minute of silence is the most an operator has to wait to see
    #: it.
    metrics_interval_seconds: float = Field(default=60.0, ge=5, le=3600)
    #: Retention: how long the worker keeps rows nobody reads any more before
    #: it deletes them, in days; 0 keeps that table for ever. Business audit
    #: events are the history an administrator reads back; sign-in records
    #: (`auth.login` and the refused attempts) are a security log and the bulk
    #: of the table; a finished outbox row is kept only for the operator to
    #: read what went out; a finished generation run is read by the
    #: coordinator who asked for it, for a day or two. Expired sessions and
    #: account links have no setting: a missing row answers exactly as an
    #: expired one. The override records a republish reads are never deleted,
    #: whatever the audit age (`oncall.retention`).
    retention_audit_days: int = Field(default=365, ge=0, le=36500)
    retention_login_audit_days: int = Field(default=90, ge=0, le=36500)
    retention_outbox_days: int = Field(default=90, ge=0, le=36500)
    retention_runs_days: int = Field(default=30, ge=0, le=36500)
    #: The worker's rhythm and the size of one deletion: a pass runs every
    #: interval, deletes the oldest expired rows in batches of this size, one
    #: short transaction each, and stops after `max_batches` per table so the
    #: first pass over a database that grew for years is bounded; what it
    #: leaves is simply older on the next pass.
    retention_interval_seconds: float = Field(default=3600.0, ge=60, le=86400)
    retention_batch_size: int = Field(default=1000, ge=100, le=10000)
    retention_max_batches: int = Field(default=20, ge=1, le=1000)

    @field_validator("version")
    @classmethod
    def _blank_version_means_dev(cls, value: str) -> str:
        """An empty ONCALL_VERSION (a copied .env with the line unset) is a dev build."""
        return value.strip() or DEV_VERSION

    @field_validator("oncall_switch_url")
    @classmethod
    def _switch_url_is_a_web_address(cls, value: str | None) -> str | None:
        """Blank is unset; anything else must be an http(s) address, since a
        reader follows it straight from the e-mail."""
        url = (value or "").strip()
        if not url:
            return None
        if not url.lower().startswith(("https://", "http://")):
            raise ValueError("ONCALL_SWITCH_URL must start with https:// or http://")
        return url

    @field_validator("smtp_host", "smtp_local_hostname")
    @classmethod
    def _blank_smtp_host_is_unset(cls, value: str | None) -> str | None:
        """Blank is unset, as Compose passes an unset variable: no host turns
        e-mail off, no local hostname lets the EHLO carry the system's FQDN."""
        return (value or "").strip() or None

    @field_validator("smtp_username", "smtp_password")
    @classmethod
    def _blank_smtp_credential_is_unset(cls, value: str | None) -> str | None:
        """Blank is unset: aiosmtplib logs in whenever a username is not None,
        which a relay without authentication refuses. Anything else is used
        exactly as written, since a password may begin or end with a space."""
        return value if value and value.strip() else None

    @model_validator(mode="after")
    def _smtp_credentials_come_in_pairs(self) -> Self:
        """A username alone would log in with an empty password, and a
        password alone would not log in at all: mail would go out
        unauthenticated from a deployment that meant to authenticate."""
        if (self.smtp_username is None) != (self.smtp_password is None):
            raise ValueError(
                "Set both ONCALL_SMTP_USERNAME and ONCALL_SMTP_PASSWORD to log in to the SMTP "
                "server, or leave both empty for a relay that accepts the application without "
                "logging in."
            )
        return self

    @model_validator(mode="after")
    def _smtp_tls_is_one_mode(self) -> Self:
        """aiosmtplib refuses both at once on every send; saying so at startup
        is what keeps the outbox and the backup alert from failing silently."""
        if self.smtp_use_tls and self.smtp_starttls:
            raise ValueError(
                "ONCALL_SMTP_USE_TLS and ONCALL_SMTP_STARTTLS exclude each other: TLS from the "
                "first byte (usually port 465) needs ONCALL_SMTP_STARTTLS=false."
            )
        return self

    @model_validator(mode="after")
    def _https_requires_secure_cookie(self) -> Self:
        """An https deployment must issue a `Secure` session cookie.

        Without this a TLS deployment that forgot the flag would keep serving
        the auth cookie over the pre-redirect cleartext request; failing at
        startup makes that misconfiguration impossible to run silently.
        """
        if self.public_base_url.lower().startswith("https://") and not self.session_cookie_secure:
            raise ValueError(
                "ONCALL_PUBLIC_BASE_URL is https:// but ONCALL_SESSION_COOKIE_SECURE is false; "
                "set ONCALL_SESSION_COOKIE_SECURE=true so the session cookie is never sent in "
                "cleartext."
            )
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
