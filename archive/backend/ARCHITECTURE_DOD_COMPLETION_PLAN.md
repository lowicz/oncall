# Execution plan for closing the Architecture Definition of Done

Status: complete; Agent 5 confirmed all nine DoD items on the final SHA `2b6fcf6` (2026-09-21), evidence in section 15  
Prepared: 2026-09-20  
Source: independent audit of `ARCHITECTURE_ACTION_PLAN.md` and the current tree  
Scope: `backend/src/oncall`, backend tests, architecture documentation and contract gates  
Primary constraint: preserve public behavior and persisted data unless the owner separately approves a reproduced defect fix

## 1. Goal

This plan closes the real, not the declared, Definition of Done from
`ARCHITECTURE_ACTION_PLAN.md`. It finishes the four gaps found in the audit:

1. the central `oncall/models.py` is still required by ordinary feature
   work;
2. the most important use cases still receive broad port bundles and broad
   protocols;
3. HTTP has an explicit Unit of Work, but the transaction boundaries of the worker,
   the outbox and the policy helper are scattered;
4. the business date is injectable, but some runtime time reads bypass
   the shared `Clock`.

The plan does not repeat the five DoD items already met. Instead it keeps them
as mandatory regression gates: contracts, domain dependencies, the
solver/rules cross-check, worker recovery on PostgreSQL and comments describing the
current intent.

## 2. Decisions binding on all agents

These decisions are settled. An agent should not reopen them during
implementation.

- `oncall/models.py` is deleted, not replaced with another file
  re-exporting all the models.
- ORM models will belong to the infrastructure modules of their features.
  One module may only register the mappers for Alembic and the test
  `create_all`; it must not re-export classes.
- All wall-clock reads at runtime go through `domain.clock`.
  `time.monotonic()` for measuring the duration of an operation remains a separate,
  proper mechanism.
- Commit and rollback are performed by the Unit of Work boundary. Adapters and use
  cases only stage or flush changes. Seed scripts remain standalone entry
  points and may explicitly close their own transactions.
- The worker may need several short transactions per task: claim,
  draft save, heartbeat and finalisation. Each has one named owner;
  the network provider and the solver do not run under a database lock.
- A port is defined by its consumer. An adapter may structurally
  implement several small protocols; we do not create a wrapper that only
  forwards calls.
- We add no database migrations. The names of tables, columns, indexes, constraints,
  enums and the values stored in the database must remain identical.
- We do not change HTTP paths, payloads, statuses, cookies, CSV, iCalendar,
  messages, ordering or the solver's result. A contradiction found stops
  the given PR and goes back to the owner as a separate defect note.
- `ARCHITECTURE_ACTION_PLAN.md` may not be given the status "complete" again on
  the basis of a description of changes. Only the independent Agent 5 closes the
  status, after all the final gates pass.

## 3. Target, measurable DoD

| ID | Final condition | Machine evidence |
|---|---|---|
| DOD-1 | External contracts without an unapproved change | OpenAPI snapshot, full pytest, HTTP/cookie/CSV/iCal/notification/solver tests |
| DOD-2 | The domain has inward-pointing dependencies and does not import frameworks/ORM | allowlist test in `tests/architecture/test_dependencies.py` |
| DOD-3 | Every request and every atomic worker step has one transaction owner | source guard for `commit`/`rollback`, request UoW test, worker UoW and crash point tests |
| DOD-4 | All runtime dates and instants are consistent and injectable | source guard forbidding `date.today`, `datetime.now` and `utcnow` outside `domain/clock.py` |
| DOD-5 | The solver and the rules evaluator remain mechanically consistent | `test_generated_schedule_obeys_rules.py` and fixed-seed fixtures |
| DOD-6 | No central model/schema registry in ordinary feature work | no `src/oncall/models.py`, no `oncall.models` imports, Alembic metadata without a diff |
| DOD-7 | Worker states, recovery and concurrency are explicit and checked on PostgreSQL | the whole of `test_concurrency_postgres.py`, crash-point and abandoned-run tests |
| DOD-8 | Comments describe the current invariants, not QA history | source guard for round/defect identifiers plus human review |
| DOD-9 | Navigation is simpler: no broad bundles and no behaviour-free shims | port structure test, no legacy names, two manual traces HTTP → use case → adapter → table |

The DoD is binary. An `xfail`, a skipped PostgreSQL, a partial mypy, a green test
without a regression-detecting mutation, or a "done" description in a document do not
close a condition.

## 4. Agent working model

The work is split into six PRs. The PRs are merged in the given order.
An agent starts from a fresh branch created after the predecessor's merge.

```text
Agent 0: executable DoD gates
             |
Agent 1: complete Clock seam
             |
Agent 2: delete central ORM registry
             |
Agent 3: split consumer-owned ports
             |
Agent 4: centralize worker transactions
             |
Agent 5: independent final audit and closure
```

The sequence is deliberate. These are cross-cutting changes with overlapping imports;
parallel PRs would cost more conflicts and could hide a regression during
the merge. Different agents provide a fresh review of successive layers, but do not
edit the same tree at the same time.

Before starting, every agent:

1. reads this document, the relevant section of the original plan, ADR-001 and the glossary;
2. checks for a clean worktree and the SHA it is working on;
3. runs the tests targeted at its layer;
4. identifies the characterisation test before the first production change;
5. preserves the user's changes and the changes from earlier PRs.

## 5. Agent 0 - DoD Gatekeeper

### Mission

Turn the four missing criteria from prose into executable guards before production
code starts to change.

### File ownership

- `backend/tests/architecture/`
- new `backend/tests/architecture/test_completion_dod.py`
- any helpers exclusively under `backend/tests/architecture/`
- `backend/contracts/README.md` only to describe the new commands

Does not edit `src/` or the OpenAPI snapshot.

### Tasks

1. Add four independent source tests:
   - `DOD-3`: a disallowed `commit`/`rollback` outside the agreed list of boundaries;
   - `DOD-4`: direct wall-clock time outside `domain/clock.py`;
   - `DOD-6`: the `oncall.models` file/import;
   - `DOD-9`: broad legacy types and compatibility aliases.
2. Encode the current gaps as `xfail(strict=True)` with the DoD ID. Each subsequent
   agent removes only the marker corresponding to its fix, in the same PR in which
   the guard starts to pass.
3. For DOD-3 explicitly allow `database.py` and the seed entry points. Do not
   allow workers, notification services, use cases or adapters.
4. For DOD-4 exclude only `time.monotonic()` and historical migrations.
   SQLAlchemy column defaults in the current runtime are also to use
   `domain.clock.utc_now`.
5. For DOD-9 forbid at least the names `SchedulingPorts`, `AdminPorts`,
   `AccessPorts`, `SharingPorts`, `AvailabilityPorts`, `Schedules` and
   `RotationBook`. Add a limit of at most 8 methods per `Protocol` and 8 fields
   per bundle; smaller limits are welcome if they follow from the consumer.
6. Prove the guards' sensitivity through temporary mutations in the test or
   production files and revert them before the commit.

### PR-0 acceptance

- the full suite stays green with exactly four expected DoD `xfail`s;
- every removal of an `xfail` on the current code causes a readable failure;
- Ruff, format, mypy and the OpenAPI snapshot pass;
- no production changes.

## 6. Agent 1 - Clock Completer

### Mission

Close DOD-4 without changing semantics: Warsaw for the business day, UTC for instants,
the monotonic clock for durations.

### File ownership

- `src/oncall/domain/clock.py`
- `src/oncall/auth.py`
- `src/oncall/account_tokens.py`
- `src/oncall/ical.py`
- `src/oncall/notifications/service.py`
- `src/oncall/infrastructure/sqlalchemy/access.py`
- `src/oncall/models.py` only as far as the time defaults go; Agent 2 will delete the file
- `src/oncall/seed_admin.py`, `src/oncall/seed_demo.py`
- the tests corresponding to these paths

### Tasks

1. Replace all runtime `datetime.now(UTC)`, `date.today()` and
   `datetime.utcnow()` with calls to `utc_now()` or `business_today()`.
2. Keep the optional `now` argument wherever a use case already accepts it;
   the fallback is to use the Clock, not the standard library.
3. Inject `FrozenClock` in the auth, cookie max-age, token expiry,
   iCalendar DTSTAMP, outbox lease/retry and audit timestamp tests.
4. Add the 23:30 UTC / 01:30 Europe/Warsaw edge case, so that the business
   day and the instant cannot be confused again.
5. Remove the `xfail` only from the DOD-4 guard.

### PR-1 acceptance

- the DOD-4 guard passes with no exceptions for runtime code;
- the time tests do not use the real clock;
- `time.monotonic()` in the solver/worker remains;
- serialized iCalendar, cookies and OpenAPI are unchanged;
- the full suite and the PostgreSQL suite pass.

## 7. Agent 2 - Persistence Topology

### Mission

Remove the central ORM registry and assign every mapped row to a feature, without
changing the SQL schema or leaving re-export shims behind.

### Target map

| Module | Classes |
|---|---|
| `infrastructure/sqlalchemy/access_models.py` | `User`, `AccountToken`, `Session` |
| `infrastructure/sqlalchemy/team_models.py` | `TeamMember`, `Eligibility` |
| `infrastructure/sqlalchemy/scheduling_models.py` | `Schedule`, `ScheduleRun`, `Assignment`, `SchedulingPolicy` |
| `infrastructure/sqlalchemy/notification_models.py` | `NotificationOutbox`, `NotificationChannel`, `NotificationStatus` |
| `infrastructure/sqlalchemy/audit_model.py` | `AuditEvent` |
| existing feature modules | `Availability`, `CalendarEvent`, `ShareLink`, `CalendarFeedToken`, `SwapRequest`, `SwapRequestSlot` |

`infrastructure/sqlalchemy/model_registry.py` may import modules solely
for the side effect of registering the mappers. It exports no classes and is used only
by Alembic, the test bootstrap and any app bootstrap that requires the full
metadata.

### File ownership

- `src/oncall/models.py`
- `src/oncall/infrastructure/sqlalchemy/*model*.py`
- all `oncall.models` import sites in `src/`, `tests/` and `migrations/`
- `migrations/env.py`
- mapper, metadata and persistence tests

Does not change ports or transaction boundaries.

### Tasks

1. Move the classes, do not copy them. Every table has one mapped class.
2. Import enums directly from `domain.vocabulary`; the outbox enums belong to
   the notification module.
3. Resolve relationships between modules with forward types and mapper names without
   an import cycle. The mapper registry loads all modules before `create_all` and
   Alembic autogenerate.
4. Rewrite all roughly 130 import sites, including tests. Tests import
   the feature's model or the vocabulary, never the registry.
5. Delete `src/oncall/models.py`. Leave no compatibility module.
6. On a clean PostgreSQL database run `alembic upgrade head`, then
   `alembic check`; the result must not propose any migration.
7. Compare before/after: table names, columns with types/nullability/defaults,
   PK/FK, unique/check constraints and indexes.
8. Remove the `xfail` only from the DOD-6 guard.

### PR-2 acceptance

- `rg 'oncall\.models' src tests migrations` returns zero;
- `src/oncall/models.py` does not exist;
- `alembic check` on PostgreSQL says there are no new operations;
- the full suite, the 22+ PostgreSQL tests, Ruff, format, mypy and OpenAPI pass;
- `git diff migrations/versions` is empty.

## 8. Agent 3 - Consumer-owned Ports

### Mission

Close DOD-9: a use case sees only the capabilities it uses, and the name of
a port says which consumer it exists for.

### File ownership

- `src/oncall/domain/**/ports.py`
- use case modules under `src/oncall/domain/`
- `src/oncall/bootstrap/providers.py`
- composition functions in `src/oncall/infrastructure/sqlalchemy/`
- fakes under `tests/domain/`
- port architecture tests

Does not change ORM models, the schema or the transaction policy.

### Tasks

1. Split scheduling by its five consumers: policy, generation, drafts,
   publication and queries. Do not pass a global `SchedulingPorts`.
2. Split `Schedules` into protocols corresponding to draft reads, generation
   writes, corrections/transitions and publication.
3. Split `SchedulingJournal` into generation, draft and publication events.
4. Split admin into account administration, membership administration,
   eligibility administration and audit queries; remove the global `AdminPorts` and
   the broad `RotationBook`.
5. Split access at least into sign-in, account-link/password and own-profile;
   remove the global `AccessPorts`.
6. Remove `SharingPorts` and the `AvailabilityPorts` alias. The existing small
   sharing/availability ports remain if they have a production consumer.
7. If a use case needs one protocol, pass the protocol without
   a single-element dataclass wrapper.
8. Adapters implement the protocols structurally; do not add forwarding
   classes just so that every name has a class.
9. Add an architecture test that no bundle exceeds 8 fields, no
   `Protocol` 8 methods, and the forbidden names have not returned.
10. Remove the `xfail` only from the DOD-9 guard.

### PR-3 acceptance

- all the forbidden broad names from PR-0 are gone;
- every use-case module receives its own port or small direct protocols;
- fakes have a smaller scope and do not implement methods unused by the given
  test cluster;
- no new adapter was created that only forwards 1:1 to the old one;
- the full suite, the PostgreSQL suite and all contract/static gates pass.

## 9. Agent 4 - Transaction and Worker Boundary

### Mission

Close DOD-3 and the last open fragment of the worker: one explicit owner of every
transaction, no commits in adapters/services, explicit state transitions in the queue
repository.

### File ownership

- `src/oncall/database.py`
- `src/oncall/worker.py`
- `src/oncall/notifications/service.py`
- `src/oncall/policy.py`
- the scheduling generation queue adapter and the corresponding narrow ports from PR-3
- Unit of Work, crash point, queue/recovery and PostgreSQL concurrency tests

Does not change public models or HTTP contracts.

### Tasks

1. Provide one reusable boundary helper based on
   `SqlAlchemyUnitOfWork(factory)`. Only it performs commit/rollback.
2. Change `load_policy`: create-if-missing uses `flush`, not `commit`.
3. Replace the rollback after an enqueue conflict with a savepoint (`begin_nested`) or
   an equivalent technique that does not wipe the whole request transaction.
4. Move the raw ORM `_claim_run` and the conditional finalisation from `worker.py` to
   a narrow queue/claim adapter. Keep `FOR UPDATE SKIP LOCKED` and the compare-
   and-set on the `running` state.
5. Name the atomic generation steps: recover, claim, load/solve-and-store,
   heartbeat and finish. Each opens exactly one UoW; no helper below
   the boundary performs a commit.
6. Keep the progress reporter's separate session and no concurrent use of one
   `AsyncSession` by two tasks.
7. Split the outbox into: a transactional claim, a provider call outside a transaction and
   a transactional record outcome. `notifications/service.py` performs no
   commit.
8. Prove with tests that the lock is not held during the solver or provider
   I/O, that a crash after send can still repeat at most one message, and that the lease and
   the stable idempotency key remain unchanged.
9. Add mutation checks for: a removed commit boundary, missing `SKIP LOCKED`,
   finalisation without the status guard and a provider call inside a transaction.
10. Remove the `xfail` only from the DOD-3 guard.

### PR-4 acceptance

- at runtime `.commit()`/`.rollback()` occur exclusively in the Unit of Work;
  the seed entry points are the only explicit exception;
- the worker does not import `SessionFactory` for manual transaction management;
- `worker.py` builds no SQL queries against `ScheduleRun`;
- the request UoW test and the worker session-isolation test pass;
- all crash-point and PostgreSQL concurrency tests pass;
- the external polling/auth/notification behavior is unchanged.

## 10. Agent 5 - Independent Closure Auditor

### Mission

Independently confirm the whole. This agent may not be the author of PR-1 to PR-4 and does
not start from the progress declarations in the documents; it starts from the code and the tests.

### File ownership

- tests/guards only if they detect missing evidence;
- `ARCHITECTURE_ACTION_PLAN.md` and this document only after a positive audit;
- glossary/ADR only to correct a description that is actually outdated.

Does not fix a larger gap "while at it". If it finds an unmet DoD,
it returns the specific PR to the appropriate agent.

### Audit

1. Run all the commands from section 12 on the final merge commit.
2. Confirm zero DoD-related `xfail`s and zero unexpected skips beyond
   explicitly environmental tests; run the PostgreSQL suite separately, and do not accept
   skips as a result.
3. Perform two traces without a global search:
   - command: HTTP create/modify → presentation → use case → consumer port →
     adapter → table/outbox → UoW;
   - query: HTTP read → presentation → query use case/read port → adapter →
     response mapper.
4. Review all protocols and bundles above the agreed limit; an exception requires
   a justification in an ADR, not a "temporary" comment.
5. Check that the mapper registry has not become a new `models.py`: there are no
   re-exports and ordinary feature imports do not use it.
6. Search for direct time sources, commits/rollbacks, framework imports in
   the domain, legacy names and historical comments.
7. Compare the OpenAPI JSON structurally with the approved snapshot.
8. In PostgreSQL run the migrations from scratch and `alembic check`.
9. Review the diff of the whole series for new factories/strategies/managers
   that have only one caller and isolate nothing. Remove them or
   return the PR to its author.
10. Only after all of that change the status of the documents to complete and append
    the final evidence table with the SHA and the command results.

### PR-5 acceptance

- the nine DoD rows have the status PASS and evidence from the final SHA;
- there are no DoD `xfail` markers;
- there are no open "leftover", "compatibility", "temporary" or "next slice" items in
  the code covered by this plan;
- the document does not contradict the code;
- the worktree after the audit is clean.

## 11. Handoff and review rules

Every PR ends with a short handoff file/description containing:

- the base and final SHA;
- the list of changed invariants;
- the characterisation test run before the change;
- the mutation or negative attempt confirming the sensitivity of the new test;
- the result of the targeted and full gates;
- an explicit statement "OpenAPI changed: no" and "DB schema changed: no";
- the remaining risks, without announcing the next phase as finished.

The reviewer does not accept a PR if:

- a test was weakened to accept the new structure;
- a new compatibility re-export hides an unfinished migration;
- an adapter performs a commit because "it was easier that way";
- a PostgreSQL test was replaced with SQLite;
- the OpenAPI snapshot was updated without the owner's separate consent;
- a mechanical move is mixed with an unapproved behaviour change.

## 12. Mandatory final commands

Run from `backend/` unless stated otherwise:

```bash
./.venv/bin/pytest -q
./.venv/bin/ruff check src tests scripts
./.venv/bin/ruff format --check src tests scripts
./.venv/bin/mypy
./.venv/bin/python scripts/openapi_snapshot.py
```

The PostgreSQL contract database, run separately. It is exclusively a disposable
container with `tmpfs`; it has to be recreated so that the migrations start on an empty
database. We check Alembic first, and only then the concurrency suite, whose
fixture creates the tables without Alembic:

```bash
docker compose -f ../docker-compose.contract.yml down
docker compose -f ../docker-compose.contract.yml up -d --wait
ONCALL_DATABASE_URL='postgresql+asyncpg://oncall_contract:oncall_contract@127.0.0.1:55432/oncall_contract' \
  ./.venv/bin/alembic upgrade head
ONCALL_DATABASE_URL='postgresql+asyncpg://oncall_contract:oncall_contract@127.0.0.1:55432/oncall_contract' \
  ./.venv/bin/alembic check
ONCALL_TEST_POSTGRES_URL='postgresql+asyncpg://oncall_contract:oncall_contract@127.0.0.1:55432/oncall_contract' \
  ./.venv/bin/pytest -q tests/test_concurrency_postgres.py
```

Source checks whose exact logic is to be pinned down by Agent 0:

```bash
rg 'from oncall\.models|import oncall\.models' src tests migrations
rg '\.(commit|rollback)\(' src/oncall
rg 'date\.today|datetime\.now|datetime\.utcnow' src/oncall
rg 'SchedulingPorts|AdminPorts|AccessPorts|SharingPorts|AvailabilityPorts|class Schedules|class RotationBook' src tests
```

The expected final result of the last four checks is zero, apart from precisely
documented exceptions: the `SystemClock` implementation, the Unit of Work and
the standalone seed entry points.

## 13. Risks and responses

| Risk | Signal | Response |
|---|---|---|
| A mapper not loaded after the model split | `failed to locate a name` error, a table missing from the metadata | one registry side effect for bootstrap/Alembic; a test of the configuration of all mappers |
| An accidental schema change | `alembic check` proposes operations | stop the PR, compare the metadata; no new migration |
| Loss of atomicity after removing a commit | audit/outbox written without the business change or the other way round | rollback/recorded-refusal tests before and after the refactor |
| A lock held through the solver/provider | the second worker waits instead of using `SKIP LOCKED` | a two-worker test with a controlled overlap on PostgreSQL |
| Excessive fragmentation of ports | many 1:1 wrappers and constructors without alternatives | pass a single Protocol without a wrapper; remove indirection-only classes |
| The Clock changes serialized time | a different cookie max-age/DTSTAMP/retry boundary | FrozenClock and golden output for the exact instant |
| Tests pass because they do not touch the changed branch | a mutation causes no failure | a mandatory negative test or mutation check in the handoff |

## 14. Closure condition

The plan is done only when Agent 5, on one final SHA, confirms
all nine DOD items, the PostgreSQL suite is not skipped, OpenAPI and the schema
are unchanged, and the four guards added by Agent 0 pass without `xfail` and
without temporary exceptions. The mere merge of all the PRs is not evidence
of completion.

## 15. Final closure evidence (Agent 5)

The audit of the series, both traces and the structural review were performed on 2026-09-21 on
`04c172481e0d0dba58602552b9a96edc7858a4c1` (`main` after the merge of PR #19).
Agent 5 was not the author of any PR in the series. The closing commit
`2b6fcf64ca3fd2979a063c15dcf0d3e1ad15f7a3` adds the DOD-8 guard in
`tests/architecture/test_completion_dod.py` (see below) and otherwise changes
only this document, `ARCHITECTURE_ACTION_PLAN.md` and `AGENTS.md`; it does not
touch `src/`, the migrations or the snapshot. Therefore `src/`, `migrations/` and
`contracts/openapi.json` are byte-identical between `04c1724` and `2b6fcf6`.
The section 12 commands for SQLite (pytest, ruff check, ruff format --check, mypy,
the OpenAPI snapshot) and the DOD-8 guard were measured again on the final SHA
`2b6fcf6`; the PostgreSQL flow (migrations from scratch, `alembic check`,
`test_concurrency_postgres.py`) and the four source checks were measured on
`04c1724` and - given the byte identity of `src/`, `migrations/` and the snapshot -
carry over to `2b6fcf6` unchanged.

PR series: Agent 0 - #5, Agent 1 - #6, Agent 2 - #15, Agent 3 - #17,
Agent 4 - #19. PRs outside the plan (#7-#10, #16, #18) landed in between.

### Section 12 commands

| Command | Result |
|---|---|
| `pytest -q` (SQLite, `2b6fcf6`) | 664 passed, 26 skipped; all 26 are `ONCALL_TEST_POSTGRES_URL is not set`; 0 xfail, 0 xpass; the two tests more than the 662 on `04c1724` are the two new DOD-8 guard tests |
| `ruff check src tests scripts` | All checks passed |
| `ruff format --check src tests scripts` | 291 files already formatted |
| `mypy` | Success: no issues found in 111 source files |
| `python scripts/openapi_snapshot.py` | OpenAPI contract matches the snapshot |
| `alembic upgrade head` (empty PostgreSQL 17, `tmpfs`) | 32 migrations, head `0032_normalize_user_identity` |
| `alembic check` | No new upgrade operations detected |
| `pytest tests/test_concurrency_postgres.py` (PostgreSQL) | 26 passed in 24.8 s; as many as SQLite skipped |
| `rg 'from oncall\.models\|import oncall\.models' src tests migrations` | 0 hits; `src/oncall/models.py` does not exist |
| `rg '\.(commit\|rollback)\(' src/oncall` | only `database.py` (UoW), `seed_admin.py`, `seed_demo.py` |
| `rg 'date\.today\|datetime\.now\|datetime\.utcnow' src/oncall` | only `domain/clock.py` (`SystemClock`) |
| `rg 'SchedulingPorts\|AdminPorts\|...' src tests` | only the literals in the DOD-9 guard |

### The nine DoD rows

| ID | Status | Evidence on the final SHA `2b6fcf6` (structural and PostgreSQL evidence measured on the byte-identical `04c1724`) |
|---|---|---|
| DOD-1 | PASS | the OpenAPI snapshot structurally equal to `app.openapi()` (63 paths, 77 operations, 95 schemas); the plan's PRs did not touch `contracts/openapi.json`; the only change in the series window is #9 (the `app_name`/`app_subtitle` fields in `/api/v1/config`, a separately approved product change outside the plan); `tests/contract/test_http_contract.py`, `test_access_contract.py`, `test_admin_contract.py`, `test_ical.py`, `test_notifications.py`, `test_scheduler.py` green |
| DOD-2 | PASS | `tests/architecture/test_dependencies.py` (domain import allowlist) and `tests/test_domain_boundaries.py` (fresh interpreter, no FastAPI/SQLAlchemy/adapters) green |
| DOD-3 | PASS | the DOD-3 guard green without `xfail`; `test_unit_of_work_per_request.py`, `test_unit_of_work.py`, `test_unit_of_work_in_the_worker.py` (6), `test_outbox_crash_points.py` (6), `test_worker_progress.py` (10) green; the worker has five named steps, each on its own `SqlAlchemyUnitOfWork`; `notifications/service.py` and `policy.py` only flush |
| DOD-4 | PASS | the DOD-4 guard green; `tests/domain/test_clock.py`, `test_clock_boundary.py` (23:30 UTC / 01:30 Warsaw) green; `time.monotonic()` remains in the worker and the solver |
| DOD-5 | PASS | `test_generated_schedule_obeys_rules.py` (8) and `test_scheduler.py` (29, fixed-seed) green |
| DOD-6 | PASS | the DOD-6 guard green; `model_registry.py` contains only 9 imports of model modules and names no class; `test_model_registry.py` (8) pins: the registry maps exactly what the package defines, importing it configures no mappers, only `bootstrap/http.py`, `worker.py`, both seeds, `migrations/env.py` and `tests/conftest.py` import it; `alembic check` with no operations |
| DOD-7 | PASS | the full `test_concurrency_postgres.py` 26/26 on PostgreSQL 17; `test_abandoned_generation_runs.py`, crash points green; the `FOR UPDATE SKIP LOCKED` claim and the compare-and-set on `running` live in `SqlAlchemyRunClaims`, not in `worker.py` |
| DOD-8 | PASS | the DOD-8 guard (below) added in commit `2b6fcf6` and run green there on `src/oncall`, `scripts/` and `migrations/env.py`; human review: no QA round or defect identifiers in runtime comments; leftovers described in "Residual risks" |
| DOD-9 | PASS | the DOD-9 guard green; inventory: 70 protocols, the largest with 7 methods (`SignInAccounts`, `AccountBook`, `TeamDirectory`, `PublishedRoster`, `SchedulePublication`, `ShareLinks`); 26 bundles, the largest with 8 fields (`PublicationPorts`, exactly at the limit); the legacy names occur only as guard literals; the two traces below |

### The two manual traces

Command, `POST /api/v1/swaps`: `routes/swaps.py::create_swap` →
`presentation/swaps.py::SwapRequestCreate` → `domain/swaps/use_cases.py::request_swap(SwapRequestInput, SwapPorts)`
→ `SwapRequestStore.add` → `infrastructure/sqlalchemy/swaps.py::SqlAlchemySwapRequests.add`
(`swap_requests` and `swap_request_slots` rows, `flush` only) → `SwapJournal.requested`
→ `SqlAlchemySwapJournal.requested` → `notifications/triggers.py::notify_swap_requested`
→ `enqueue_notification` (a `notification_outbox` row, `flush`) and `audit.record_audit`
(an `audit_events` row) → `swap_response` → commit in `database.py::get_db`
(`SqlAlchemyUnitOfWork`, a function-scoped dependency from `bootstrap/providers.py::DbSession`).
A `RecordedRefusal` refusal crosses the same boundary through `commit_transaction`.

Query, `GET /api/v1/schedules/published`: `routes/published.py::published_schedule`
→ `bootstrap/providers.py::calendar_reader` (`CalendarPorts`) →
`domain/calendar/use_cases.py::dashboard(audience, ..., today=business_today())`
→ `PublishedRoster.duties_in_force` → `infrastructure/sqlalchemy/roster.py::SqlAlchemyPublishedRoster`
(`assignments`, `schedules`) and `CalendarRoster` → `SqlAlchemyCalendarRoster`
(`team_members`, `users`, `swap_requests`) → the mapper in the route to
`presentation/published.py::PublishedScheduleResponse` → the same UoW boundary.

### Structural review of the series

- Database schema: all 32 `migrations/versions` files are identical
  to `485310c~1` at the AST level (the differences are exclusively `ruff format` from #8);
  `migrations/env.py` changes only the registry import (#15). No
  migration was added.
- The new classes of the series are protocols, bundles, feature models, adapters
  and three worker values (`_Claimed`, `_Ending`, `_RequesterMissing`).
  No `*Factory`/`*Strategy`/`*Manager` name was added. `Argon2Passwords`,
  `DirectoryAuthentication` and `CpSatSolver` translate (thread, directory
  exceptions, problem mapping), they do not forward 1:1.
- `worker.py` imports `SessionFactory` only as the injection root in
  `__main__`; each step opens a UoW on the factory passed in.

### Evidence gap closed by Agent 5

The DoD table promised a "source guard for round/defect identifiers" for DOD-8,
while Agent 0's task listed four guards. The DOD-8 guard was
added in `tests/architecture/test_completion_dod.py`: it reads comments
(tokenizer) and docstrings (AST) in `src/oncall`, `scripts/` and
`migrations/env.py`, and rejects `QA-REPORT`, `QA<n>`, `round <n>` and
`phase <n>`; historical migrations and tests are out of scope (finding A14
concerns production comments; migration `0032` cites QA7 and stays
frozen). Sensitivity: a temporary project in the test plus a mutation of
`src/oncall/policy.py` with a `QA7 par. 8` comment, detected as
`policy.py:34 cites QA history: 'QA7'` and reverted.

### Residual risks (non-blocking)

- `routes/domain_edge.py::refusals_as_http` accepts a `db` that its body
  no longer uses; a leftover of the commits in routes from before phase 2a.
- Three "compatibility" helpers from before the plan, used exclusively by
  tests: `worker._generation_error`, `scheduler.py:1087` (the entry to model
  building) and the wording of the `User.display_name` setter docstring
  (`access_models.py:85`, the setter itself is in use by both seeds).
- Test docstrings cite QA rounds as the origin of regressions; outside
  the scope of DOD-8 (A14) and deliberately not covered by the guard. The
  `filterwarnings` comment in `pyproject.toml` cites QA7-L17.
- `PublicationPorts` has exactly 8 fields; the next publication consumer
  forces a split, not a raise of the limit.
