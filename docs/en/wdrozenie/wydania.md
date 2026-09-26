# Releases and versions

The application is released as two container images in the GitHub Container
Registry, tagged with the release number:

| Image | Services from `docker-compose.yml` | Contents |
| --- | --- | --- |
| `ghcr.io/lowicz/oncall-api` | `api`, `worker` | the API (FastAPI), database migrations, the worker process, the CP-SAT solver |
| `ghcr.io/lowicz/oncall-web` | `web` | nginx with the application (SPA) and this documentation under `/docs/` |

The images are public: `docker compose pull` requires no login. The `db`
database is the unmodified `postgres:17-alpine` image.

## Version number

The source of the version is a **git tag** of the form `vMAJOR.MINOR.PATCH`,
e.g. `v1.2.0`. A pre-release has a suffix: `v1.3.0-rc.1`. Every release gets
image tags:

| Git tag | Image tags | `latest` |
| --- | --- | --- |
| `v1.2.3` | `1.2.3`, `1.2`, `1`, `latest` | yes |
| `v1.3.0-rc.1` | only `1.3.0-rc.1` | no |

**A published version is immutable.** The `1.2.3` tag always points at the
same image; releasing again under the same number is rejected by the pipeline.
The `1.2`, `1` and `latest` tags move to the newest matching stable version -
they are convenient, but they do not say what exactly runs on the host.

## Which version runs on the host

`docker-compose.yml` pulls the images with the tag from `ONCALL_VERSION` in `.env`:

```bash
# .env
ONCALL_VERSION=1.2.3
```

Without this variable Compose **refuses to start** and says what is missing.
This is deliberate: every host declares what it runs, and the `.env` file is
the record of that decision.

The number of the release that really runs is shown by the application itself:
at the bottom of the navigation bar, at the end of the account menu under the
avatar, and on a phone on the “More” screen. It does not read it from `.env`
but from the image: the release pipeline writes the tag into both images at
build time (`ONCALL_VERSION` in `backend/Dockerfile` and
`frontend/Dockerfile`), and the API serves it in `/api/v1/config`. That is why
with `ONCALL_VERSION=1.2` in `.env` the application shows the full number,
e.g. `1.2.3`, and an image built from the repository (the development overlay)
shows `dev`.

## Update and rollback

An update is a switch to the release tag, a change of one line and a pull of
the images:

```bash
git fetch --tags
git checkout v1.2.4
sed -i 's/^ONCALL_VERSION=.*/ONCALL_VERSION=1.2.4/' .env
docker compose pull
docker compose up -d
```

After the start the version number in the account menu confirms that the new
release is running.

On a host with a systemd user unit (Podman) the whole update, together with
adding the new variables to `.env`, a backup and the restart, is done by the
`deploy/update.sh` script - see [Updating a deployment](aktualizacja.md).

The Compose files (`docker-compose.yml` and the overlays) belong to the
release just as the images do: they assume the same ports in the containers,
users and write paths (see [Container privileges](uruchomienie.md#container-privileges)).
That is why they come from the same git tag as `ONCALL_VERSION`; an image from
a different release than the Compose file may not start.

Database migrations run at the start of the `api` service (see
[Running the stack](uruchomienie.md#administrator-account)).

A rollback to the previous version looks the same, with the previous tag and
number. The images of earlier releases stay in the registry. Database
migrations do not roll back automatically - if the release changed the schema,
check in its description on GitHub whether the rollback requires additional
steps.

## Verifying image provenance

Every image has three independent proofs that it was built in this
repository's pipeline from a specific commit, without any keys stored in the
project:

- **an SBOM and BuildKit provenance** attached to the image in the registry,
- **a GitHub attestation** (SLSA), checked with `gh`,
- **a cosign signature** (keyless, the workflow's identity from GitHub's OIDC).

```bash
gh attestation verify oci://ghcr.io/lowicz/oncall-api:1.2.3 --owner lowicz

cosign verify ghcr.io/lowicz/oncall-api:1.2.3 \
  --certificate-identity https://github.com/lowicz/oncall/.github/workflows/release.yml@refs/tags/v1.2.3 \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```

The same commands for `oncall-web`. The description of every release on GitHub
contains the digests of both images and ready-made verification commands.

## How a release is made

A release is made by the repository maintainer with one command:

```bash
git tag -a v1.2.3 -m "v1.2.3"
git push origin v1.2.3
```

The `release.yml` workflow in GitHub Actions:

1. checks that the tag name is a valid version number and that this version
   is not yet in the registry,
2. runs the same gates as for every change (lint, types, tests on SQLite and
   PostgreSQL, image builds, checks of the Compose files and the documentation),
3. builds and publishes both images with the tags from the table above,
   attaching the SBOM, provenance, attestation and signature,
4. creates the release on GitHub with automatically generated release notes
   and the digests.

The pipeline uses only the GitHub Actions token and the OIDC identity; the
repository stores no secrets. If a release fails after an image has been
published (e.g. because the signing service was briefly unavailable), re-run
**only the failed jobs** of the same run - never create a second run with the
same tag.

## What CI checks

Every change (pull request and the `main` branch) goes through `ci.yml`:

| Job | What it checks |
| --- | --- |
| `backend` | `uv.lock` consistent with `pyproject.toml` (before the install), `ruff check`, `ruff format`, `mypy`, `pytest` on SQLite, OpenAPI consistent with the snapshot |
| `backend-postgres` | the concurrency suite on a real PostgreSQL 17 |
| `frontend` | `eslint`, `tsc`, `vitest`, `npm run build` (renders the documentation and checks the table of contents, links and anchors), the standalone site render |
| `compose-config` | the validity of `docker-compose.yml` with every overlay, that the development overlay changes only the source of the images, that every service runs read-only and without kernel capabilities, and the tests of the `deploy/update.sh` update script |
| `workflows` | every action in a workflow is pinned to a full SHA with a version comment, every workflow declares the token permissions, and the repository has no Dependabot update configuration |
| `image-build` | both Dockerfiles build (without publishing), and no image runs as root |
| `sonarcloud` | static analysis on SonarCloud (key `lowicz_oncall`) with test coverage from the `backend` and `frontend` jobs, so it starts after them; skipped without the `SONAR_TOKEN` secret |

The aggregate status `ci-ok` covers all the jobs in the table except
`sonarcloud`: a pull request from a fork has no access to `SONAR_TOKEN`, and a
missing token must not turn `ci-ok` red. The SonarCloud result is a separate
status, the `SonarCloud Code Analysis` quality gate, which SonarCloud itself
reports after the scan. To merge into `main`, the `main-protected` rule
requires `ci-ok`, the SonarCloud quality gate and both scans from the
[Security scanning](#security-scanning) section; the full list is in
[Repository settings](#repository-settings).

## Security scanning

The security of the code and dependencies consists of five elements; the first
two are security workflows running alongside `ci.yml`:

| Tool | When | What it checks and what it blocks |
| --- | --- | --- |
| CodeQL (`codeql.yml`) | every pull request, every push to `main`, weekly on Monday morning | analysis of the backend (Python), the frontend (TypeScript and JavaScript) and the workflows themselves (GitHub Actions) with the `security-extended` queries; the results go to Security → Code scanning, and the merge is blocked by the code scanning results rule in `main-protected` |
| Dependency Review (`dependency-review.yml`) | every pull request | compares the pull request's dependencies with the target branch in GitHub's dependency graph (`backend/uv.lock`, `frontend/package-lock.json`, actions in workflows); the `dependency-review` status is red when the change brings in a dependency, including a development one, with a vulnerability of severity high or critical; a pull request without dependency changes passes |
| SonarCloud (the `sonarcloud` job in `ci.yml`) | every pull request and push to `main` | code quality, vulnerabilities and test coverage; the quality gate (among others, 80% coverage of new code) reports the `SonarCloud Code Analysis` status |
| Dependabot alerts | continuously | alerts about known vulnerabilities in dependencies, in Security → Dependabot; Dependabot opens no pull requests |
| Renovate | on a schedule, and immediately on an alert | the only bot opening pull requests with updates, including security fixes (see [Dependency updates](#dependency-updates)) |

Dependabot is here solely a source of alerts. The repository has no
`.github/dependabot.yml` file (the `workflows` job rejects it in CI), and
“Dependabot security updates” in the settings are disabled, so the two bots
never open competing pull requests with the same fix.

A CodeQL alert that turned out to be false is closed in Security → Code
scanning with the “Dismiss alert” button and a stated reason; the queries in
the workflow are not disabled. A vulnerability without an available fix that
has to be accepted for now is added to the `allow-ghsas` input of the step in
`dependency-review.yml`, with a comment saying why and until when.

A pull request from a fork has no access to `SONAR_TOKEN`, so it does not
receive the `SonarCloud Code Analysis` status and waits for it. The
repository maintainer moves such a change to a branch in this repository (e.g.
`gh pr checkout <number>`, then a push under a new name) and merges it from a
pull request opened from that branch.

## Dependency updates

The dependencies are looked after by Renovate (the GitHub app by Mend,
configured in `renovate.json5` in the repository root; the repository thus
stores no secrets). It covers GitHub actions (pinned to a full SHA with a
version comment), npm and Python packages (through the lock files), the
container base images (referenced by tag, without a pinned digest) and the
tool versions repeated in the workflow files (uv, Node, Python, PostgreSQL).

The rules:

- one pull request a week per ecosystem for minor and patch updates, opened
  on Monday before 6:00 Warsaw time,
- a new package release must be at least three days old before it is
  proposed - a freshly published, possibly hijacked, version does not go into
  a PR the same day,
- security fixes (GitHub alerts and the OSV database) are created
  immediately, separately and with the `security` label,
- major version changes and every change of the runtime (Python, Node,
  PostgreSQL) wait for approval in the Dependency Dashboard - these are
  decisions, not routine,
- nothing is merged automatically; every PR goes through `ci-ok` and a review.

Such an update is approved in the **Dependency Dashboard** issue: in the
“Pending Approval” section, tick the box next to that update. On its next
run, regardless of the schedule, Renovate opens the pull request with
refreshed lock files by itself. It is not started with a manual version change
on a branch - that would skip the grouping of files that change together and
the refresh of the lock files. Code changes the update requires are added as
commits to the PR opened by Renovate. Renovate then stops updating that
branch, and a forced rebase (the box in the Dependency Dashboard or in the PR
description) would recreate it from scratch, without those commits.

A version that occurs in several files is read by Renovate in all of them from
one release source, so every one of those files gets the same version in the
same PR:

| Group | Files | Version source |
| --- | --- | --- |
| Node.js | `NODE_VERSION` in `ci.yml`, `node-version` in `pages.yml`, `frontend/Dockerfile`, the badge in `README.md` | Node.js releases |
| Python | `requires-python` in `backend/pyproject.toml`, `PYTHON_VERSION` in `ci.yml`, `backend/Dockerfile`, the badge in `README.md` | python.org releases |
| PostgreSQL | `docker-compose.yml`, `docker-compose.contract.yml`, the database service in `ci.yml`, the badge in `README.md` | Docker Hub, the same tag everywhere |
| uv | `required-version` in `backend/pyproject.toml`, `UV_VERSION` in `ci.yml`, `backend/Dockerfile` | uv releases on GitHub |

If the Node or Python image were a separate dependency from Docker Hub, it
would have a different release date: Docker Hub dates a tag such as
`22-alpine` by the last publication of the image, and an approved update
covers only the files whose version is already three days old. The image could
then stay on the old version while CI was already testing the new one. The
images are also not pinned to a digest: the Node.js and Python release lists
do not know the digests, so Renovate would not move it together with the tag,
and Docker would use the digest of the old image despite the new tag. Without
a digest, `docker compose pull` also fetches the latest patch release of the
database's tag for it. The exact digests of the base images of every release
are recorded in its provenance.

Before merging a runtime update, search the PR branch for the old version
(e.g. `git grep -n '17-alpine\|PostgreSQL 17'`). What may remain is only a
description in the documentation or in `AGENTS.md` - fix it in the same PR -
or a new place with the version, which has to be added to that group's rule in
`renovate.json5`.

The backend declares only the Python version that CI tests and the image
contains (`requires-python` in `backend/pyproject.toml`); the boundary is
moved by an approved update of the “Python” group. The ruff and mypy tools
have no version entry of their own: ruff takes it from `requires-python`, mypy
from the interpreter that runs it.
There is one uv version: uv in a version other than `required-version` refuses
to work with the project, so `backend/uv.lock` is always produced by the same
version.

## Repository settings

Some of the rules on this page are GitHub settings, not repository files.
No file in the repository sets or changes them: they are set once, by hand,
by a person with repository administrator rights, and a pull request changing
a workflow is not enough for them to take effect.

| Setting | Value |
| --- | --- |
| Settings → Rules → Rulesets → `main-protected` | the default branch; deletion and force pushes forbidden; “Require status checks to pass” with “Require branches to be up to date before merging” and the statuses from the table below; “Require code scanning results” with the CodeQL tool, “Security alerts”: High or higher, “Alerts”: Errors |
| Settings → Pages → Source | GitHub Actions |
| Settings → Advanced Security → Dependency graph | enabled (always, in a public repository): Dependency Review and the Dependabot alerts use it |
| Settings → Advanced Security → Dependabot alerts | enabled: the source of security alerts, which Renovate uses too |
| Settings → Advanced Security → Dependabot security updates | disabled: security fixes are opened by Renovate |
| Settings → Advanced Security → Code scanning → CodeQL analysis | advanced configuration from `codeql.yml`; “Default setup” not configured, because when it is enabled GitHub rejects results from the workflow |

The statuses required by “Require status checks to pass”:

| Status | Source (“Add checks”) | Where it comes from |
| --- | --- | --- |
| `ci-ok` | GitHub Actions | the aggregate job of `ci.yml` |
| `dependency-review` | GitHub Actions | `dependency-review.yml` |
| `SonarCloud Code Analysis` | SonarQube Cloud (the SonarCloud app) | the quality gate after the `sonarcloud` job |

The CodeQL results are not added as a status: they are watched by the “Require
code scanning results” rule, which waits for the CodeQL analysis of the pull
request's latest commit and blocks the merge on a new security alert of
severity high or critical or an alert of class error.

The status is named exactly `ci-ok`, because that is the name every pull
request reports it under. Under the name `ci / ci-ok` the same status appears
only in a `release.yml` run, which calls `ci.yml` as the `ci` job. A pull
request never reports that name, so a rule that requires it blocks every
merge. The setting: in the `main-protected` rule tick “Require status checks
to pass”, through “Add checks” add the three statuses from the table, each
with its source (if `ci / ci-ok` is there, remove it), tick “Require code
scanning results”, add CodeQL with the thresholds from the table above and
save the changes. The `dependency-review` and `SonarCloud Code Analysis`
statuses appear in the “Add checks” list once at least one pull request has
reported them.
Verification:

```bash
gh api repos/lowicz/oncall/rules/branches/main \
  --jq '.[] | select(.type == "required_status_checks") | .parameters.required_status_checks[].context'
# ci-ok
# dependency-review
# SonarCloud Code Analysis
gh api repos/lowicz/oncall/rules/branches/main \
  --jq '.[] | select(.type == "code_scanning") | .parameters.code_scanning_tools'
# [{"alerts_threshold":"errors","security_alerts_threshold":"high_or_higher","tool":"CodeQL"}]
gh api -i repos/lowicz/oncall/vulnerability-alerts | head -1
# HTTP/2.0 204 No Content   (Dependabot alerts enabled; 404 means disabled)
gh api repos/lowicz/oncall/automated-security-fixes --jq .enabled
# false
gh api repos/lowicz/oncall/code-scanning/default-setup --jq .state
# not-configured
```

## Documentation on GitHub Pages

This documentation is also published as a standalone site:
`https://lowicz.github.io/oncall/`. It is produced from **the same files**
`docs/*.md` and the same script `frontend/scripts/build-docs.mjs`, only in
`--site` mode (without the “Back to the application” link, with a link to the
repository and a footer with the version). The `pages.yml` workflow publishes
it after every change in `docs/` on the `main` branch. The site is not indexed
by search engines (`noindex,nofollow`); the copy in the `web` image always
matches the version of the application it was built with.
