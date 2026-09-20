# Archive

Everything that used to live in `docs/` before the directory was given over to
product and user documentation. It was **moved, not rewritten**: the files are
byte-identical to what they were, and `git log --follow` reaches their whole
history.

```
archive/docs/    the former docs/ tree, unchanged
```

## What is in there

| Kind | Files |
| --- | --- |
| Product and implementation plans | `PLAN.md`, `PLAN-ROUND-4.md`, `PLAN-NAPRAWCZY-*.md`, `PLAN-WYKONAWCZY-*.md`, `ADMIN-PANEL-PLAN.md` |
| QA rounds | `QA-REPORT*.md`, `qa-shots*/`, `qa-suite*/` |
| Design notes | `SOLVER.md`, `UI-REVIEW.md`, `TLS.md` |

## How to read it

These documents describe the project **as it stood when each was written**.
They are not maintained and they are not the specification:

- Paths inside them (`docs/qa-suite-6/…`, `docs/SOLVER.md`) refer to the
  location these files had at the time. Read them as `archive/docs/…`.
  Rewriting the paths would have edited the record itself, so they were left
  as written.
- Relative links between two archived documents still resolve, because the
  whole tree moved together.
- `TLS.md` describes the earlier deployment, which mounted a whole `tls`
  directory. The current shape - three separately mounted files - is in
  [`docs/wdrozenie/tls.md`](../docs/wdrozenie/tls.md).
- `SOLVER.md` remains the fullest description of the CP-SAT model. The rules
  and weights as the product states them today are in
  [`docs/produkt/generator.md`](../docs/produkt/generator.md).

Current documentation starts at [`docs/index.md`](../docs/index.md).
