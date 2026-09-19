# Backend compatibility contract

This directory freezes externally observable backend behavior before the
architecture migration described in `../ARCHITECTURE_ACTION_PLAN.md`.

## OpenAPI

`openapi.json` is the canonical API snapshot. Verify it with:

```bash
uv run python scripts/openapi_snapshot.py
```

After an explicitly approved contract change, inspect the generated diff and
only then replace it with:

```bash
uv run python scripts/openapi_snapshot.py --update
```

Moving modules, changing dependency wiring, or refactoring domain code is not
a reason to update the snapshot.

## Characterization suites

The compatibility gate is intentionally split by observable boundary:

- `tests/contract/test_http_contract.py` pins representative response bodies,
  validation errors, cookie attributes, headers, and endpoint inventory;
- existing focused suites pin CSV, iCalendar, scheduling, swap/override,
  authentication, sharing, outbox, worker, and solver behavior;
- `tests/test_concurrency_postgres.py` pins concurrency behavior on the contract
  database. It must run with `ONCALL_TEST_POSTGRES_URL` in CI and before changes
  to transactions, queues, publication, swaps, or availability.

SQLite is a fast feedback database, not the persistence contract. A skipped
PostgreSQL suite is acceptable locally but not in the compatibility CI job.

## Approved semantics

- Business dates use `Europe/Warsaw`; instants and stored timestamps use UTC.
- Authorization changes take effect immediately.
- Notifications are delivered at least once and use stable idempotency keys.
- Identical fixed-seed generator inputs retain exact assignments and metadata
  during refactoring.

Some current code does not yet meet these semantics. Tests added during phase 0
must expose the current behavior without silently changing it; corrections are
implemented as separately visible defect fixes in later phases.
