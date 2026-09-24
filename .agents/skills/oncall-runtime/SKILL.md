---
name: oncall-runtime
description: Load when changing or running Oncall Compose, deployment, TLS, nginx, runtime configuration, logging, or browser QA.
user-invocable: false
metadata:
  internal: true
---

## Build and run

- `docker-compose.yml` is the production file: it runs the published images
  `ghcr.io/lowicz/oncall-api` (services `api` and `worker`) and
  `ghcr.io/lowicz/oncall-web`, pinned by `ONCALL_VERSION` from `.env`, and
  refuses to start without it. Building from the checkout requires
  `docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d --build`;
  never use bare `docker compose up --build`, because the production file has
  no build definitions. The dev overlay may change nothing but `image`/`build`;
  `.github/scripts/compose-parity.sh` enforces that in CI. `.github/scripts/env-vars-wired.sh` (same CI job) fails
  if an `ONCALL_*` documented in `.env.example` is referenced by no Compose
  file, so a documented knob cannot silently go unplumbed.
- The `web` image builds from the **repository root** (`context: .`,
  `dockerfile: frontend/Dockerfile`), because the image carries `docs/` as well
  as `frontend/`. The root `.dockerignore` governs that build. `backend/Dockerfile`
  installs from `uv.lock` (`uv sync --frozen`); `pyproject.toml` alone is not
  the source of truth for what ships.
- The backend pins one uv release (`required-version` in
  `backend/pyproject.toml`, repeated as `UV_VERSION` in `ci.yml` and in
  `backend/Dockerfile`; Renovate's `uv` group moves all three). Any other uv
  refuses to run in `backend/` and prints the `uv self update` that fixes it;
  without touching the machine's uv, `uvx --from 'uv==<pinned>' uv run ...`
  runs the pinned release from the uv cache. Write `uv.lock` only with the
  pinned release.
- HTTPS is an overlay, never a flag on the base file:
  `docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d`. The
  base file mounts nothing from the host so it comes up on a machine with no
  certificate, under Docker and Podman alike. Details: `docs/wdrozenie/tls.md`.
  The directory's CA for LDAP is the same kind of overlay
  (`docker-compose.ldap-ca.yml`, `docs/wdrozenie/ldap.md`).
- Every Compose service is `read_only` with `cap_drop: [ALL]` and
  `no-new-privileges`; only `db` adds back what the postgres entrypoint needs.
  `.github/scripts/compose-hardening.sh` (CI) enforces it, so a new runtime
  write path gets its own `tmpfs` or volume, never a relaxation. The same
  script keeps `db` without host ports: its Compose password is a public local
  default (`docs/wdrozenie/uruchomienie.md`, "Hasło bazy danych"). The web image
  is `nginxinc/nginx-unprivileged` (uid 101): it listens on 8080/8443 inside
  the container and reads the TLS key as uid 101
  (`docs/wdrozenie/uruchomienie.md`, "Uprawnienia kontenerów").
- nginx sends the security headers from a shared
  `frontend/nginx-security-headers.conf` included by both presets and re-added
  in every location that sets its own `add_header` (nginx drops inherited ones);
  the CSP and HSTS live next to each include. The app CSP is strict
  (`script-src 'self'`), so the SPA theme bootstrap stays external in
  `frontend/public/theme-init.js`; `/docs/` relaxes only `script-src` for its
  inline pre-paint scripts. `frontend/scripts/nginx-headers.test.mjs` guards it.
- An https `ONCALL_PUBLIC_BASE_URL` requires `ONCALL_SESSION_COOKIE_SECURE=true`
  or `Settings` (`backend/src/oncall/config.py`) refuses to start; the TLS
  overlay sets it for `api` and `worker`. The login throttle / security log
  trust `X-Real-IP` only from `ONCALL_TRUSTED_PROXIES` (`routes/access.py`).
- The API process logs `oncall.*` at INFO to stderr (`configure_logging` in
  `backend/src/oncall/bootstrap/http.py`, run from the lifespan) and leaves
  libraries at WARNING, so SQLAlchemy never logs statements with their
  parameters. Sign-in outcomes are logfmt `event=login` / `event=ldap_auth`
  lines from `backend/src/oncall/login_log.py`; never log a secret there.
- The disposable contract PostgreSQL (`docker-compose.contract.yml`, port
  55432) takes its Compose project name from the checkout directory, `oncall`,
  like the main stack: pass `-p <other-name>` to its `up` and `down`.
- `podman compose` here delegates to the Docker Compose plugin and needs
  `systemctl --user start podman.socket` first. A user oneshot that brings
  the stack up after reboot is `deploy/systemd/oncall.service` (it calls
  `oncall-stack.sh`; not Quadlet); setup and linger are in
  `docs/wdrozenie/systemd.md`. Such a host upgrades with `deploy/update.sh`
  (POSIX sh, meant for `curl | sh -s -- X.Y.Z`; `docs/wdrozenie/aktualizacja.md`):
  it merges `.env` into the release's `.env.example` changing no value but
  `ONCALL_VERSION`, so a new deploy-side file or `.env` convention must keep
  `deploy/update.test.sh` (CI job `compose-config`) green under dash and mawk.
- Browser QA of the frontend against the published images: start the
  compose stack (API on 8080) and run the Vite dev server with its `/api`
  proxy pointed at `http://localhost:8080`; the checked-in
  `frontend/vite.config.ts` proxies to the backend dev server on 8000. The
  calendar API answers one request of at most 90 days.

Before declaring a disposable local audit complete, stop its isolated stack and remove audit-only temporary files unless preservation was explicitly requested.
