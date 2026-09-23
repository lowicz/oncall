# On-call

On-call scheduling application for infrastructure teams: who is `PRIMARY`,
`SECONDARY` and on the `11-19` shift, a fair generator, swaps, availability,
reports and calendar feeds. The name shown in the interface, e-mails and
calendar feeds is a deployment setting (`ONCALL_APP_NAME`, with an optional
`ONCALL_APP_SUBTITLE`), so the repository itself carries no organisation brand.

[![ci](https://github.com/lowicz/oncall/actions/workflows/ci.yml/badge.svg)](https://github.com/lowicz/oncall/actions/workflows/ci.yml)
[![release](https://github.com/lowicz/oncall/actions/workflows/release.yml/badge.svg)](https://github.com/lowicz/oncall/actions/workflows/release.yml)

Product and user documentation lives in [`docs/`](docs/index.md) and is rendered
into static HTML served by the application itself at `/docs/`, reachable from
the "Dokumentacja" link in the top bar. The same pages are published at
<https://lowicz.github.io/oncall/> from the same source. The earlier contents
of `docs/` - plans, QA reports, screenshots and test scripts - are preserved
unchanged in [`archive/docs/`](archive/README.md).

## Running

Every release publishes two images, `ghcr.io/lowicz/oncall-api` (services
`api` and `worker`) and `ghcr.io/lowicz/oncall-web`, tagged with the release
version. `docker-compose.yml` runs them; `ONCALL_VERSION` in `.env` says which
version, and Compose refuses to start without it.

```bash
cp .env.example .env      # set ONCALL_VERSION, ONCALL_ADMIN_USERNAME, ONCALL_ADMIN_PASSWORD
docker compose pull
docker compose up -d
```

The frontend is served at `http://localhost:8080`, while the API is available through the same origin under `/api`.
Versions, upgrades, rollback and image verification: [docs/wdrozenie/wydania.md](docs/wdrozenie/wydania.md).
To start the Podman stack after reboot without an interactive login, use the user systemd unit: [docs/wdrozenie/systemd.md](docs/wdrozenie/systemd.md).
Such a host moves to another release, `.env` merged with the new `.env.example` and the unit restarted, with one command: [docs/wdrozenie/aktualizacja.md](docs/wdrozenie/aktualizacja.md).

```bash
curl -fsSL https://raw.githubusercontent.com/lowicz/oncall/main/deploy/update.sh |
  sh -s -- 1.2.3
```

## Development

Building from the checkout is an overlay on the same file (`ONCALL_VERSION`
can be anything, e.g. `dev`; the overlay names the local images
`oncall-api:dev` and `oncall-web:dev`):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Put `COMPOSE_FILE=docker-compose.yml:docker-compose.dev.yml` in `.env` to make
plain `docker compose up --build` do the same. CI (`.github/workflows/ci.yml`)
runs the backend and frontend gates, the PostgreSQL concurrency suite, both
image builds and every Compose combination on each pull request, next to
SonarCloud, CodeQL and Dependency Review; a tag `vX.Y.Z` publishes the images
(`.github/workflows/release.yml`). Required checks and repository security
settings: [docs/wdrozenie/wydania.md](docs/wdrozenie/wydania.md).

The API container derives its Uvicorn worker count from the cgroup CPU quota or
process affinity, with a minimum of two processes. Set `ONCALL_API_WORKERS` to a
positive integer to override it. Each process owns its SQLAlchemy connection
pool, so keep the chosen worker count and PostgreSQL `max_connections` aligned.
Read-heavy deployments also use a bounded per-process cache for resolved
published duties (1 s). Set `ONCALL_EFFECTIVE_ASSIGNMENTS_CACHE_SECONDS=0` for
strict cross-worker read-after-write visibility. Authenticated sessions are not
cached: every request revalidates the session, so signing out, resetting a
password or deactivating an account takes effect at once.

For HTTPS, the web container mounts three separate files - the server
certificate without its chain, the private key, and the complete system trust CA
bundle - through an overlay compose file:

```bash
docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d
```

See [docs/wdrozenie/tls.md](docs/wdrozenie/tls.md).

## Local backend

```bash
docker compose up -d db
cd backend
uv sync --extra dev
uv run alembic upgrade head
ONCALL_ADMIN_USERNAME=admin ONCALL_ADMIN_PASSWORD='change-me-now' uv run python -m oncall.seed_admin
uv run uvicorn oncall.main:app --reload
```

uv must be the release pinned by `required-version` in `backend/pyproject.toml`;
any other refuses to run and prints the command that installs the right one.

The gates CI runs, in the same order: `uv run ruff check .`, `uv run ruff format --check .`,
`uv run mypy`, `uv run pytest`, `uv run python scripts/openapi_snapshot.py`. The
PostgreSQL concurrency suite needs a disposable database:
`docker compose -f docker-compose.contract.yml up -d` and
`ONCALL_TEST_POSTGRES_URL=postgresql+asyncpg://oncall_contract:oncall_contract@127.0.0.1:55432/oncall_contract uv run pytest tests/test_concurrency_postgres.py`.

For Docker Compose, put the credentials in `.env`. On every API start the bootstrap
creates the account or synchronizes its password, display name, admin role and active
status. A password rotation therefore takes effect after rebuilding/restarting `api`.
Passwords must contain at least 12 characters. With both variables unset, bootstrap is
skipped.

To populate a local environment with a two-week schedule and three example accounts:

```bash
ONCALL_DEMO_PASSWORD='local-demo-password' uv run python -m oncall.seed_demo
```

The logins are `admin`, `anna`, `marek`, `ola`, `piotr`, and `viewer`; the password
comes from the environment variable. Set `ONCALL_DEMO_EMAIL_DOMAIN` (for example
`example.com`) to also assign `{login}@{domain}` notification addresses to the demo
accounts.

## LDAP / Active Directory login

LDAP is optional and disabled by default. Enable it with `ONCALL_LDAP_ENABLED=true`
and configure the server URI, service-account bind, search base and filter using the
`ONCALL_LDAP_*` variables documented in `.env.example`. The default attribute mapping
uses `employeeNumber`, `givenName`, `sn` and `mail`; each name can be overridden.
`ONCALL_LDAP_USER_FILTER` must contain the literal `{username}` placeholder.

Authentication uses a service bind to find exactly one directory entry and then binds
as that entry to verify the submitted password; the entry's attributes are read only
after the password is proven. `ldap://` uses StartTLS by default; `ldaps://` uses TLS
directly, and the directory's certificate is always validated. When it comes from an
internal CA (AD CS), point `ONCALL_LDAP_CA_FILE` at that CA's PEM bundle, mounted with
the `docker-compose.ldap-ca.yml` overlay; no image rebuild is needed.

Every sign-in writes one `event=login` line to the API log, and a directory attempt that
does not end with an identity adds an `event=ldap_auth` line with the same `attempt=` id,
naming the phase that stopped it and a reason code. Passwords, session tokens, the service
account's credentials, DNs, attribute values and the directory's own error text are never
logged. The phases, reasons and what to change for each are in `docs/wdrozenie/ldap.md`.

The first successful directory login creates an active `viewer` account keyed by the
numeric personnel number. Later logins synchronize the login, first name, last name and
e-mail while preserving the locally managed role, status, rotation and eligibility.

### Linking a manually created account with AD

A local account created by an administrator (for example to prepare somebody's role and
rotation before their first day) links with AD automatically on the person's first
directory login, provided the account's **personnel number matches `employeeNumber`
in AD**. The directory verifies the person's credentials and vouches for that number,
so the link is safe. On linking the account converts to `ldap`: the local password
stops working, the username and personal data sync from AD, and the locally managed
role, activity flag, rotation and eligibility are preserved. The event is recorded in
the audit log as `auth.ldap_linked`.

If the personnel number does not match (typo or missing), no link happens: a login
attempt ends with a 409 conflict recorded as `auth.ldap_identity_conflict`, and the
administrator fixes the number on the account. Accounts without a personnel number
never link. A successful local password never touches the directory, so a directory
outage does not block active local accounts or invalidate existing sessions.

## Historical schedule import

Coordinators and administrators can validate and import a UTF-8 CSV from the dashboard.
The required columns are `service_date` (`YYYY-MM-DD`), `role` (`primary`, `secondary`
or `late_shift`) and `assignee_name` (an exact team member display name). The UI includes
a downloadable template; a ready-to-use example is in `examples/history.csv`.

## Schedule generator

Administrators and coordinators can select `hybrid` (the default), `daily`, or
`weekly` in the dashboard and generate a draft for up to 35 days. Generation uses
the first day not covered by a published schedule as its suggested start. The
suggested end is the Sunday after four complete Monday-Sunday weeks (28-34 days);
an explicit range opened from the calendar takes precedence.
Generated draft names include the rotation mode and a `DD-MM-YYYY` range.
Generation uses role eligibility, hard unavailability, soft preferences and the previous 12 months of
assignments. Saturdays, Sundays and Polish statutory holidays count as 2 points.
That history is read through the same per-slot resolution as the fairness report, so a
day covered by two publications counts once and the generator and `#sprawiedliwość`
always agree on what somebody has already served. Primary, secondary, the 11-19 shift,
weekend duty and holiday duty are each balanced on their own.
Generated schedules remain drafts and store the mode used; they never replace a
published schedule automatically. A coordinator explicitly moves a result from
`draft` to `proposed`, then confirms publication. Each transition checks the expected
version. Publication is serialized in PostgreSQL, validates complete coverage and
supersedes only published schedules fully covered by the new range; partial overlaps
are resolved per slot and retain coverage outside the new range.

The rules, weights, acceptance criterion and time budget are documented in
[docs/produkt/generator.md](docs/produkt/generator.md); the CP-SAT model as it
stood when the generator was built is in
[`archive/docs/SOLVER.md`](archive/docs/SOLVER.md).

Solver derives its default worker count from the container's CPU quota (or process
affinity when no quota exists), capped at eight. Override it explicitly with
`ONCALL_SOLVER_WORKERS` and enable diagnostic search output with
`ONCALL_SOLVER_LOG=true`. The wall-clock budget is a field of the scheduling
policy (5-300 seconds, 15 by default), edited by a coordinator under
"Ustawienia generatora"; no environment variable sets it. The asynchronous UI
path runs in the Compose `worker` service, which has an explicit allocation of
two CPUs; changing that allocation automatically changes the default solver
worker count.

## Single-day swaps

A team member can request a replacement for one exact date and role, even when the
base rotation is weekly. Only eligible, available members who are not already assigned
to the opposite on-call role are offered. The replacement accepts first and a
coordinator or administrator approves the override. Before approval, the replacement
or coordinator may reject the request and its author may withdraw it; both decisions
require a reason. Approval changes only the selected slot and increments the published
schedule version.

## E-mail notifications

Swap lifecycle events, schedule publications, coordinator overrides and number
handover reminders enqueue rows in the `notification_outbox` table inside the same
transaction as the business change. A separate worker process (`docker compose`
service `worker`, or `python -m oncall.worker`) drains pending rows with exponential
backoff and delivers them through channel providers. The channel is the extension
point: `email` is implemented today, and new providers (for example MS Teams) plug
into the same outbox without touching business logic.

Delivery is at-least-once. A worker claims a batch under a lease, sends each
message with no transaction open, and records each outcome on its own, so a
worker that dies mid-drain can repeat at most the one message that was in
flight - never the batch. Every message carries the outbox row's id as a stable
idempotency key, which the SMTP provider spends as a fixed `Message-ID`, so a
repeat is recognisable as the same message rather than a new one.
`ONCALL_NOTIFICATION_LEASE_SECONDS` (default 300) sets how long a claim holds
before the row becomes deliverable again.

E-mail delivery uses an external SMTP service configured through environment
variables; no mail server is hosted by this project. Set `ONCALL_SMTP_HOST`,
`ONCALL_SMTP_PORT`, `ONCALL_SMTP_USERNAME`, `ONCALL_SMTP_PASSWORD`,
`ONCALL_SMTP_USE_TLS` / `ONCALL_SMTP_STARTTLS` and `ONCALL_EMAIL_FROM`. If the SMTP
server requires a specific client name in EHLO/HELO, set
`ONCALL_SMTP_LOCAL_HOSTNAME`. Without `ONCALL_SMTP_HOST`, messages are marked
`skipped` with the reason recorded in the outbox. Notification e-mails go to the
addresses stored on user accounts; administrators can set them with
`PATCH /api/v1/admin/users/{id}` until the full administration screen arrives.

## Worker metrics

The worker reports what it is doing on its own logger, `oncall.metrics`, one
logfmt record per measurement (`event=queue queued=3 oldest_queued_seconds=41.0`).
Two of the records are sampled on a timer set by `ONCALL_METRICS_INTERVAL_SECONDS`
(default 60) and are emitted whether or not anything is happening, so a gap in
them means the worker itself has stopped. The other two are events: `generation`
when a run ends, and `generation_abandoned` when a recovery sweep frees runs a
dead worker was holding.

| Record | Fields |
|---|---|
| `queue` | `queued`, `running`, `oldest_queued_seconds` (how long the coordinator who has waited longest has been waiting), `stalest_running_seconds` (the oldest heartbeat among held runs; it approaches `ONCALL_STALE_RUN_SECONDS` exactly when recovery is about to step in) |
| `outbox` | `eligible` and `oldest_eligible_seconds` (messages a drain would take right now, and how long the oldest has been owed), `retrying`, `attempts_max`, `waiting` (serving a backoff, held under a lease, or parked because the channel is disabled), `dead` (failed for good) |
| `generation` | `run`, `outcome`, `queued_seconds` (the wait), `run_seconds` (the work). `outcome` is `completed`, `infeasible` (the roster and the hard rules disagree - the inputs must change), `requester_missing`, `error` (a defect in the application) or `reclaimed` (the solve finished after the run had been declared abandoned, so it was thrown away: `ONCALL_STALE_RUN_SECONDS` is too tight for this roster) |
| `generation_abandoned` | `runs` - how many runs were freed from a worker that died holding them. Logged as a warning |

Nothing here is written to the database, and the API process emits none of it:
the numbers are worth what the worker's log output is worth, so keep it.

## ICS calendar feeds

Calendar applications subscribe to revocable token URLs served under `/calendar`
(proxied by nginx). A member creates a personal feed (`#ics` in the dashboard) that
exposes only their own duties as all-day events with the schedule version as the
event sequence, so calendar apps see overrides and swaps as updates. An
administrator can additionally issue an ICS channel for a viewer share link, scoped
to the link's date range and expiry.

## Temporary viewer links

Administrators create one-time links (`#udostepnienia` in the dashboard) bound to a
recipient label, a date range and an expiry of at most 30 days. Opening
`/share/{token}` exchanges the one-time token for a limited viewer session and the
SPA removes the token from the address bar. The session sees only the published
schedule clipped to the link range, expires with the link and dies immediately when
the link is revoked.

## Fairness report

The `#sprawiedliwosc` screen balances actual duties from published and superseded
schedules over a rolling 12-month window. Weekdays count 1 point (X); Saturdays,
Sundays and Polish statutory holidays count 2 points (2X) without cumulating
multipliers. Primary, secondary, weekends, holidays and 11-19 shifts are balanced
separately, and each category's expected share is proportional to the member's
eligible days in the window. Weekend lenses cover Saturday/Sunday on-call duties,
while the holiday lens covers statutory holidays on weekdays so the two never
double-count a day. Clicking a member drills down to their individual duties.
Coordinators and administrators see the whole team; members see only themselves.

## Audit log

Significant operations (logins and failed logins, availability changes, the swap
lifecycle, draft generation, publication, overrides, policy changes, history
imports, share links and feed tokens, account administration) are recorded in the
`audit_events` table inside the same transaction as the change itself. The actor
label is denormalized so the trail survives account deletion and can describe
non-user actors such as share links. Administrators browse and filter the log in
the `#audyt` panel.

## Policy weight tuning

Coordinators and administrators can tune the solver weights (`fairness_weight`,
`continuity_weight`, `preference_weight`) next to the rotation mode in the
generator form. Weight updates are validated (0-100), audited and apply to the
next generation run.

## Local frontend

```bash
cd frontend
npm install
npm run dev
npm run build:docs        # renders docs/*.md to public/docs, served at /docs/
npm run build:docs:site   # the same pages as a standalone site (site/), as on GitHub Pages
```

`npm run build` renders the documentation first (`prebuild`), so a production
build can never ship stale pages. The renderer also fails the build on a page
missing from `docs/toc.json`, a link leaving the documentation tree, or an
anchor matching no heading. `.github/workflows/pages.yml` publishes the `--site`
output to GitHub Pages on every change to `docs/` on `main`; nothing is
authored twice.
