# ADR-001: Feature-oriented hexagonal boundaries

Date: 2026-09-15  
Status: accepted

## Context

The backend already uses domain use cases, protocols and SQLAlchemy adapters,
but package-wide ORM/API modules and route-local composition preserve an older
layered structure. Adding another architectural style would increase rather
than reduce the number of conventions.

## Decision

The backend will converge incrementally on feature-oriented hexagonal modules.
Each feature owns its domain policy, application operations, persistence and
HTTP translation. Dependencies point inward:

```text
HTTP / worker -> application -> domain
SQLAlchemy / OR-Tools -------^       ^
```

- Domain code is framework-free and persistence-free.
- Application code owns orchestration, not transport serialization.
- Entry points own one explicit unit of work.
- Ports are consumer-owned and introduced only at meaningful volatile or
  process boundaries.
- Queries may use purpose-built read models instead of rich write repositories.
- Pure functions remain functions; classes are not required for architectural
  conformity.

The migration is feature by feature. Contract snapshots and characterization
tests must pass after every slice.

The current executable guard lives in
`tests/architecture/test_dependencies.py`. The strict typing ratchet initially
covers the clock, contract-snapshot tool and architecture test; every phase must
add its newly stabilized modules rather than attempting a noisy big-bang typing
migration.

## Consequences

Feature code becomes easier to locate and dependency direction becomes
executable. During migration, a small number of package-root pure-policy imports
will remain; no new domain dependency on HTTP, ORM, worker or API-schema modules
is allowed. Mechanical moves and behavioral corrections remain separate.
