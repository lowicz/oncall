# Stage N1 - Unblocking the solver (BLK-01, HGH-01)

Status: **done** (2026-09-06)

## The user's blocking item (a NO-OP in this stage)

The user added a separate blocking problem about hard unavailability.
It was taken over by `STAGE-BLOCKING.md`. It is NOT covered here.

## Done

1. **BLK-01** The `add_assumption(spacing_enabled)` + `only_enforce_if` mechanism was replaced
   with building two independent models through the new helper `_build_model(*, spacing: bool)`
   (`backend/src/oncall/scheduler.py`).
   - `spacing=True` compiles the spacing rules as hard constraints,
   - after `INFEASIBLE` with `spacing=True`, a second model is built with `spacing=False`
     and the solve is retried; success attaches the warning „Reguły rozrzedzania musiały
     zostać zawieszone..." (a complete draft with a warning, never a 409).
2. **BLK-01** Solver parameter: `solver.parameters.num_search_workers` (deprecated
   in OR-Tools 9.15) replaced with `solver.parameters.num_workers`. We do not set both.
3. **HGH-01** The default `ONCALL_SOLVER_SECONDS` budget raised from 30 to 90 s:
   - `config.py` (`Field(default=90.0, ...)`),
   - `docker-compose.yml` (api and worker),
   - `.env.example`, `README.md`, `archive/docs/SOLVER.md`,
   - `SOLVE_SECONDS = 90.0` in `scheduler.py`.
4. `archive/docs/SOLVER.md`: the description of the hard spacing rules rewritten from "conditioned
   on a CP-SAT assumption" to "compiled into hard constraints + a second pass".

## Tests (added/kept in `tests/test_scheduler.py`)

- `test_spacing_rules_are_never_assumption_gated` - monkeypatches `add_assumption`
  so that it raises should anyone bring it back (regression for the BLK-01 blocker).
- `test_solver_uses_num_workers_instead_of_deprecated_field` - records the parameters
  `num_workers=4` and `num_search_workers=0`.
- `test_spacing_fallback_returns_complete_draft_with_warning` - the fallback path
  yields a complete draft + a warning, not an empty failure (the equivalent of "not a 409").
- The existing `test_infeasible_spacing_is_retried_with_an_explicit_warning` still passes.

## Verification

- `uv run --extra dev python -m pytest tests/test_scheduler.py -q` -> **28 passed**.
- Full backend except the solver: `uv run --extra dev python -m pytest -q --ignore=tests/test_scheduler.py`
  -> **164 passed**.
- The solver test suite time dropped from ~134 s to ~40 s (effect of parallelism).

## Plan exit criterion (extended)

- 91 days on 2 cores finishes with a complete schedule in each of ten
  consecutive runs. **To be verified on the target hardware/docker**
  (here: the `cpus: 2` limit of the worker container was not reproduced in the session).
  Suggested verification script: run `POST /api/v1/scheduling/runs` 10x
  for the range 2027-01-04..2027-04-04 and check `completed` + `schedule_id`.

## How to continue

- Next stage N2 (`STAGE-N2.md`) - HGH-03/HGH-04/HGH-02, waiting to start.
