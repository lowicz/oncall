# Stage BD-01 - Hard unavailability as a hard constraint of the draft lifecycle

Status: **done** (2026-09-06)

## Problem (reported by the user as blocking)

A generated draft contains an unavailable person („nie mogę"). Breakdown of the problem:
the solver itself never assigns a person with hard unavailability (the model filters
the candidates - confirmed by fuzzing: 60 attempts, 0 violations), but the draft could have been
created for a day on which somebody entered the unavailability LATER (after generation).
Publishing such a draft would put an unavailable person on a live duty,
which the model would never have generated - the gap was at the EDGE of the lifecycle:
`propose_schedule` / `publish_schedule` did not re-validate hard unavailability.

## Scope (hard rule)

- `Propose` of a draft with an unavailable person -> 409, `reason: UNAVAILABLE`, message
  „Szkic zawiera osoby z twardą niedostępnością; wygeneruj grafik ponownie",
  conflict list `YYYY-MM-DD · rola: <imię> ma twardą niedostępność`.
- `Publish` of a proposal with an unavailable person -> identical 409.
- A signal in `generate_schedule` after solve (safety net) - should the model ever
  want to emit an unavailable person, it returns INFEASIBLE with a readable message
  instead of writing to the database.

## Files

- `backend/src/oncall/scheduler.py` - new safety net after `solution()`
  (a loop over the assignments, checks `preference(day) == unavailable`).
- `backend/src/oncall/routes/scheduling.py` - new helper
  `_hard_unavailability_conflicts(schedule, db)` (straightforward:
  member_id -> `unavailable` ranges, then an overlap check against
  `service_date`; skips assignments without `member_id`); called in
  `propose_schedule` and `publish_schedule` after the state/version change,
  in publish after `_validate_complete`. `Availability` imported into the models.
- `backend/tests/test_schedule_unavailability_guard.py` - 3 integration tests
  (propose 409, publish 409, propose OK after the entry is deleted).

## Frontend compatibility

`errorMessage` in `frontend/src/api.ts:421-431` reads `detail.message` when detail is
an object, so the message passes through 1:1. The frontend was not changed.

## Verification

- `uv run --extra dev python -m pytest tests/test_schedule_unavailability_guard.py -q`
  -> **3 passed**.
- Generation/publication tests: `test_draft_delete.py`, `test_draft_persistence.py`,
  `test_partial_republish.py`, `test_schedule_workflow.py`, `test_draft_override.py`
  -> **22 passed**.
- `tests/test_scheduler.py` -> **28 passed** (the safety net does not break the solver).

Re-verification on 2026-09-06 after N2 started:

- `uv run --extra dev python -m pytest tests/test_schedule_unavailability_guard.py -q`
  -> **3 passed** in 0.74 s. The `propose`/`publish` protection stays green.

## Conclusion

The user's problem is solved at the API level; the generator never produces
an unavailable person, and publication does not let such a draft slip through.
