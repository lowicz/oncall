# Contributing

Thank you for considering a contribution to Oncall. This is a small,
largely solo-maintained project, so focused issues and pull requests are the
easiest to review.

## Before you start

Use the normal GitHub flow: open an issue for a bug, proposal, or substantial
change, then submit a pull request from a topic branch. Small, self-contained
fixes may go directly to a pull request. Keep each change focused and explain
both the problem and the chosen solution.

[The README's Running section](README.md#running) describes how to run a
release. Its
[Development](README.md#development),
[Local backend](README.md#local-backend), and
[Local frontend](README.md#local-frontend) sections are the canonical setup
instructions. Follow [AGENTS.md](AGENTS.md) for the repository's architecture,
coding conventions, language rules, and CI details.

## Languages and documentation

Polish is the default product and documentation language; English is the second
language. Keep user-facing text in the language catalogues described in
[AGENTS.md](AGENTS.md#languages).

Product and user documentation lives in `docs/` in Polish and in `docs/en/` in
English. A documentation change must update both trees, including their tables
of contents when relevant. Keep corresponding pages and heading structures in
sync.

## Local checks

Run the same checks as CI before opening a pull request. Follow the setup in the
README, use the versions pinned by the repository, and run backend tools through
`uv` from `backend/`.

For the backend:

```bash
cd backend
uv lock --check
uv sync --extra dev --frozen
uv run --frozen ruff check .
uv run --frozen ruff format --check .
uv run --frozen mypy
uv run --frozen pytest
uv run --frozen python scripts/openapi_snapshot.py
```

Also run the PostgreSQL migration and concurrency checks described under
[Local backend](README.md#local-backend). They verify migrations from an empty
database, ORM migration consistency, and concurrent behaviour against
PostgreSQL.

For the frontend:

```bash
cd frontend
npm ci
npm run lint
npm run typecheck
npm test -- --coverage
npm run build
node scripts/build-docs.mjs --site
```

Finally, verify every Compose combination, the repository's workflow-security
checks, and both container image builds when your change can affect them. The
authoritative commands and complete job list are in
[`.github/workflows/ci.yml`](.github/workflows/ci.yml). CI reruns all required
gates on the pull request, including the PostgreSQL suite, and must pass before
the contribution can be merged.

## Commits and pull requests

Follow the repository's established commit-message form:
`type(scope): summary`, or `type: summary` when no scope adds value. Examples
from the project history include `fix(reports): ...`, `feat(retention): ...`,
`chore(deps): ...`, `build(frontend): ...`, and `docs: ...`.

In the pull request:

- link the relevant issue when one exists;
- describe user-visible effects and important technical decisions;
- include tests for changed behaviour;
- call out documentation, migration, deployment, or security implications; and
- confirm the local checks you ran.

Reviews, requested changes, and required CI checks are handled through the
normal GitHub pull request workflow.
