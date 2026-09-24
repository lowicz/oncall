# Project agent memory

This file is the project's committed home for project-intrinsic agent knowledge: build, test, release, architecture, and sharp-edge notes that should travel with the code.

## Layout

- `docs/` is only for maintained product and user documentation in Polish (the
  UI is Polish), rendered to static HTML and served at `/docs/`. Never put QA
  reports, plans, test scripts or screenshots there. Every page must be listed
  in `docs/toc.json`.
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
- Only `SqlAlchemyUnitOfWork` (`backend/src/oncall/database.py`) commits or
  rolls back; the seed entry points are the one exception. HTTP gets one per
  request through `get_db`; the worker gets its session factory in
  `worker_main` and opens one per named step. Adapters and use cases only
  flush. The DOD-3 guard in the same test module enforces it.
- Runtime comments and docstrings describe current intent. The DOD-8 guard
  in `tests/architecture/test_completion_dod.py` rejects QA-round, defect and
  plan-phase identifiers (`QA-REPORT`, `QA7`, `round 4`, `phase 5`) under
  `src/oncall`, `scripts/` and `migrations/env.py`; historical migrations and
  tests are outside its scope.
- Notification e-mails: `backend/src/oncall/notifications/templates.py`
  chooses the words (subject, plain text, HTML) and `layout.py` next to it owns
  the one Outlook-safe HTML layout (tables, inline styles, light-theme hex
  tokens). `tests/test_email_templates.py` lints every template against the
  constructs Outlook drops and pins one rendering in `tests/snapshots/`;
  regenerate it with `UPDATE_EMAIL_SNAPSHOTS=1 pytest tests/test_email_templates.py`.
- `frontend/scripts/build-docs.mjs` renders `docs/` into
  `frontend/public/docs/` (gitignored). It runs as `prebuild`, so `npm run
  build` always refreshes it, and it fails the build on an unlisted page, a
  link leaving the documentation tree, or an anchor matching no heading.

## CI and releases

- Run backend checks from `backend/` through `uv`; never invoke bare tools or
  guess `.venv` paths. `README.md` ("Local backend") gives the canonical test
  and quality commands.
- `.github/workflows/ci.yml` is the gate list (backend: `uv lock --check`
  before the install, ruff check + format, mypy, pytest on SQLite, OpenAPI
  snapshot; backend-postgres: migrations from empty plus `alembic check`, then
  the concurrency suite against postgres:17; frontend: eslint, tsc, vitest,
  `npm run build`, site render; compose-config; workflows; image-build
  without push). `ci-ok` is the one status of ci.yml the ruleset
  `main-protected` requires; pull requests report it as `ci-ok`, never
  `ci / ci-ok`, which is its name only under release.yml. SonarCloud (`sonarcloud` job, identity in
  `sonar-project.properties`) is not in `ci-ok` needs and skips cleanly when
  `SONAR_TOKEN` is missing, so `ci-ok` stays green for forks; the ruleset
  requires its quality gate as the separate `SonarCloud Code Analysis`
  status. The gate wants 80% coverage on new code, read from the
  `backend/coverage.xml` (`pytest --cov`) and `frontend/coverage/lcov.info`
  (`npm test -- --coverage`) reports the test jobs upload, so changed lines
  need tests. Run the same required commands locally before pushing.
  Before opening a PR, compare the complete branch diff with the authorized task scope and stop for review if unrelated paths are present.
- Security scanning: `codeql.yml` (advanced setup; GitHub's default setup
  must stay off) and `dependency-review.yml` (fails on high/critical). The
  full list of required checks and admin-only settings is
  `docs/wdrozenie/wydania.md` ("Ustawienia repozytorium"). Dependabot only
  raises alerts: `.github/scripts/workflow-security.sh` (CI job `workflows`)
  rejects a `.github/dependabot.yml`, an unpinned action or a workflow
  without top-level `permissions`.
- A tag `vX.Y.Z[-pre]` runs `.github/workflows/release.yml`: validates the tag,
  calls `ci.yml`, publishes both images with SBOM, provenance, attestation and
  cosign signature, creates the GitHub Release. Published versions are
  immutable; the workflow refuses a version already in GHCR. Release uses only
  `GITHUB_TOKEN` and OIDC (no release secrets). User-facing description:
  `docs/wdrozenie/wydania.md`.
- Actions are pinned to full commit SHAs with a version comment; Renovate
  (`renovate.json5`, the Mend GitHub App - no Dependabot) moves them, together
  with both lockfiles, the base images (by tag, no digest pins) and the tool
  versions repeated in the workflow `env` blocks. A version named in several
  files (uv, Node, Python) is one custom regex manager on one datasource, and
  the built-in manager that would also read one of those lines is disabled
  there: a group moves only the members whose release date passed the
  three-day rule, so a second datasource lets one file stay behind. A new
  reference joins that manager. Keep new tool versions in the `env` blocks.
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
  Irreversible actions go through `components/ConfirmDialog`; one opened from
  a `Panel` is rendered beside it, not inside, because Base UI draws no
  backdrop for a nested dialog.
- Dates and months are native inputs (`DateField`, `MonthField`, ISO values
  in and out); selects are native `<select>`. Tests drive them with
  `fireEvent.change`, not with option clicks.
- Every number, date, weekday and month a screen prints goes through
  `src/lib/numbers.ts` (decimal comma) and `src/lib/dates.ts` (DD-MM-RRRR, one
  weekday set equal to the API's `weekday`); screens call no `toLocaleString`
  and keep no name arrays of their own.
- The product name and subtitle come from `/api/v1/config`
  (`ONCALL_APP_NAME`, `ONCALL_APP_SUBTITLE`) through `useBranding()`; the
  source tree carries no organisation name.
- The theme preference lives in `localStorage` under `oncall-theme`
  (`dark` | `light` | `system`); the SPA applies it before first paint from the
  external `public/theme-init.js` (external so the CSP stays strict) and the
  docs template (`scripts/build-docs.mjs`) inlines the same logic with the same
  key, and `src/theme.ts` owns it afterwards.
- API failures reach screens as `ApiError` (`parseError` in `src/api.ts`,
  including FastAPI's list-shaped 422 `detail`); a raw `fetch` in `api.ts`
  throws through `parseError` too. A 401 while signed in is handled once, in
  the query client (`src/session.ts`): screens do not handle session loss.
- `src/test/setup.ts` pins the clock to a fixed instant. Screens hide actions
  for dates already past, so fixtures written as concrete dates need it.

## Maintaining this file

Keep this file for knowledge useful to almost every future agent session in this project.
Do not repeat what the codebase already shows; point to the authoritative file or command instead.
Prefer rewriting or pruning existing entries over appending new ones.
Never add machine-local tool versions, session-specific QA notes, or temporary observations.
When updating this file, preserve this bar for all agents and keep entries concise.
