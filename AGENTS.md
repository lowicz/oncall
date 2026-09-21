# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

## Layout

- `docs/` - product and user documentation in Polish (the UI is Polish), rendered
  to static HTML and served at `/docs/`. Every page must be listed in
  `docs/toc.json`.
- `archive/docs/` - the former `docs/` tree: plans, QA reports, screenshots and
  test scripts. Historical, not maintained; see `archive/README.md`. Source
  comments that cite `archive/docs/PLAN.md` or `archive/docs/SOLVER.md` point
  there.
- ORM rows live in the feature-owned `*_model.py`/`*_models.py` modules under
  `backend/src/oncall/infrastructure/sqlalchemy/`; there is no central
  `models.py`. A new model module joins `model_registry.py`, which only the
  process entry points, `migrations/env.py` and `tests/conftest.py` import
  (`tests/architecture/test_model_registry.py` holds both rules).
- Ports are consumer-owned: each backend use-case module takes its own small
  `*Ports` bundle, or one protocol directly, from its feature's `ports.py`.
  Adapters satisfy them structurally without subclassing; strict mypy over
  `bootstrap/providers.py` is what checks the fit. The DOD-9 guard in
  `tests/architecture/test_completion_dod.py` caps protocols and bundles at 8
  members and forbids the old broad bundle names.
- `frontend/scripts/build-docs.mjs` renders `docs/` into
  `frontend/public/docs/` (gitignored). It runs as `prebuild`, so `npm run
  build` always refreshes it, and it fails the build on an unlisted page, a
  link leaving the documentation tree, or an anchor matching no heading.

## Build and run

- `docker-compose.yml` is the production file: it runs the published images
  `ghcr.io/lowicz/oncall-api` (services `api` and `worker`) and
  `ghcr.io/lowicz/oncall-web`, pinned by `ONCALL_VERSION` from `.env`, and
  refuses to start without it. Building from the checkout is the overlay
  `docker-compose.dev.yml` (`-f docker-compose.yml -f docker-compose.dev.yml`),
  which may change nothing but `image`/`build`; `.github/scripts/compose-parity.sh`
  enforces that in CI.
- The `web` image builds from the **repository root** (`context: .`,
  `dockerfile: frontend/Dockerfile`), because the image carries `docs/` as well
  as `frontend/`. The root `.dockerignore` governs that build. `backend/Dockerfile`
  installs from `uv.lock` (`uv sync --frozen`); `pyproject.toml` alone is not
  the source of truth for what ships.
- The backend pins one uv release (`required-version` in
  `backend/pyproject.toml`, repeated as `UV_VERSION` in `ci.yml` and in
  `backend/Dockerfile`; Renovate's `uv` group moves all three). Any other uv
  refuses to run in `backend/` and prints the `uv self update` that fixes it;
  write `uv.lock` only with the pinned release.
- HTTPS is an overlay, never a flag on the base file:
  `docker compose -f docker-compose.yml -f docker-compose.tls.yml up -d`. The
  base file mounts nothing from the host so it comes up on a machine with no
  certificate, under Docker and Podman alike. Details: `docs/wdrozenie/tls.md`.
- The disposable contract PostgreSQL (`docker-compose.contract.yml`, port
  55432) takes its Compose project name from the checkout directory, `oncall`,
  like the main stack: pass `-p <other-name>` to its `up` and `down`.
- `podman compose` here delegates to the Docker Compose plugin and needs
  `systemctl --user start podman.socket` first.
- Browser QA of the frontend against the published images: start the
  compose stack (API on 8080) and run the Vite dev server with its `/api`
  proxy pointed at `http://localhost:8080`; the checked-in
  `frontend/vite.config.ts` proxies to the backend dev server on 8000. The
  calendar API answers one request of at most 90 days.

## CI and releases

- `.github/workflows/ci.yml` is the gate list (backend: ruff check + format,
  mypy, pytest on SQLite, OpenAPI snapshot; backend-postgres: migrations from
  empty plus `alembic check`, then the concurrency suite against postgres:17;
  frontend: eslint, tsc, vitest, `npm run build`, site render; compose-config;
  image-build without push). `ci-ok` is the one required status. Run the same
  commands locally before pushing.
- A tag `vX.Y.Z[-pre]` runs `.github/workflows/release.yml`: validates the tag,
  calls `ci.yml`, publishes both images with SBOM, provenance, attestation and
  cosign signature, creates the GitHub Release. Published versions are
  immutable; the workflow refuses a version already in GHCR. No repository
  secrets exist or are needed. User-facing description: `docs/wdrozenie/wydania.md`.
- Actions are pinned to full commit SHAs with a version comment; Renovate
  (`renovate.json5`, the Mend GitHub App - no Dependabot) moves them, together
  with both lockfiles, the base images and the tool versions repeated in the
  workflow `env` blocks (custom regex managers). Keep new tool versions in
  those `env` blocks so Renovate can see them.
- Documentation on GitHub Pages (`.github/workflows/pages.yml`) is the same
  renderer in `--site` mode (`frontend/scripts/build-docs.mjs`); never add a
  second generator or a second copy of `docs/`. The regression test for the
  renderer's link shapes is `frontend/scripts/build-docs.test.mjs`.

## Frontend conventions

- No component library: `frontend/src/ui/` holds the primitives (buttons,
  fields, dialog, side panel, popover, menu, tabs, toast, badges, empty
  states) on top of headless `@base-ui/react`; screens compose them and use
  the class names from `src/styles.css`. Colours, fonts and sizes are the
  custom properties in `src/tokens.css` (dark default, `data-theme="light"`,
  `data-density="compact"`); never hard-code a colour in a component.
- Dates and months are native inputs (`DateField`, `MonthField`, ISO values
  in and out); selects are native `<select>`. Tests drive them with
  `fireEvent.change`, not with option clicks.
- The product name and subtitle come from `/api/v1/config`
  (`ONCALL_APP_NAME`, `ONCALL_APP_SUBTITLE`) through `useBranding()`; the
  source tree carries no organisation name.
- The theme preference lives in `localStorage` under `oncall-theme`
  (`dark` | `light` | `system`); `index.html` and the docs template
  (`scripts/build-docs.mjs`) apply it before first paint with the same key,
  and `src/theme.ts` owns it afterwards.
- `src/test/setup.ts` pins the clock to a fixed instant. Screens hide actions
  for dates already past, so fixtures written as concrete dates need it.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
When updating this file, preserve this bar for all agents and keep entries concise.
