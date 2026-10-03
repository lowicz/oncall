# Archive

Everything that used to live in `docs/` before the directory was given over to
product and user documentation, and the finished plans that used to sit beside
the code. It was **moved, not rewritten**: the files are byte-identical to what
they were, and `git log --follow` reaches their whole history.

```
archive/docs/            the former docs/ tree, unchanged
archive/backend/         the backend architecture plans, formerly in backend/
archive/agent-stages/    the agent stage files, formerly in .agents/stages/
```

## What is in there

| Kind | Files |
| --- | --- |
| Product and implementation plans | `PLAN.md`, `PLAN-ROUND-4.md`, `PLAN-NAPRAWCZY-*.md`, `PLAN-WYKONAWCZY-*.md`, `ADMIN-PANEL-PLAN.md` |
| QA rounds | `QA-REPORT*.md`, `qa-shots*/`, `qa-suite*/` |
| Design notes | `SOLVER.md`, `UI-REVIEW.md`, `TLS.md` |
| Backend architecture migration (`archive/backend/`) | `ARCHITECTURE_ACTION_PLAN.md`, `ARCHITECTURE_DOD_COMPLETION_PLAN.md` (the DOD-n ids the guards in `backend/tests/architecture/` name) |
| Agent stages after QA round 4 (`archive/agent-stages/`) | `README.md`, `STAGE-*.md` |

## How to read it

These documents describe the project **as it stood when each was written**.
They are not maintained and they are not the specification:

- Paths inside them (`docs/qa-suite-6/…`, `docs/SOLVER.md`) refer to the
  location these files had at the time. Read them as `archive/docs/…`.
  Rewriting the paths would have edited the record itself, so they were left
  as written.
- Relative links between two archived documents still resolve, because the
  whole tree moved together.
- Paths in `archive/backend/` (`src/oncall/…`, `tests/…`) are relative to
  `backend/`; the stage files' states ("in_progress") are as they were left.
- `TLS.md` describes the earlier deployment, which mounted a whole `tls`
  directory. The current shape - three separately mounted files - is in
  [`docs/wdrozenie/tls.md`](../docs/wdrozenie/tls.md).
- `SOLVER.md` remains the fullest description of the CP-SAT model. The rules
  and weights as the product states them today are in
  [`docs/produkt/generator.md`](../docs/produkt/generator.md).

Current documentation starts at [`docs/index.md`](../docs/index.md).
