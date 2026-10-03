# Stage N4 - Closing the medium and security defects

Status: **done** (2026-09-06)

## State

- [x] MED-01 - the published schedule label comes from data (`schedule.id`);
  with no publication, the header and the status panel no longer claim the schedule
  is published.
- [x] MED-02 - the suggestion starts no earlier than tomorrow, takes published
  coverage and the history import into account; the publication dialog warns when a manually
  chosen range covers today or the past.
- [x] MED-03 - after a manual correction the API returns warnings about four consecutive
  days, more than three duties in seven days and a missing two days of rest;
  the generator shows the warnings above the result.
- [x] MED-04 - the correction window shows availability/note, the current owner of the
  slot and the forecast balance change of the chosen person before saving (with weight 2X for
  a day off); it uses the shared fairness forecast cache.
- [x] MED-05 - the API rejects a policy in which all three weights are zero.
- [x] MED-06 - the API keeps the compatible result list and always returns the header
  `X-Oncall-Logins-Excluded: true|false`; a search no longer returns an empty
  list without a signal that matching logins may have been filtered out.
- [x] SEC-01 - the swaps router has an explicit role guard; the availability router already used
  `MemberUser` with the same set of allowed roles.

## Changes and tests

- `routes/swaps.py`: router-level `require_roles(member, coordinator, admin)`,
  so a viewer gets 403 also for an invalid body, before the 422.
- `routes/scheduling.py`: a check of the resulting (also partially updated)
  weights before saving and auditing; three zeros -> 422 with a Polish message.
- `tests/test_rbac_regressions.py`: viewer regressions for swaps and availability.
- `tests/test_audit.py`: regression for three weights equal to zero.

## Verification

- Backend RBAC/policy: `11 passed`; Ruff: `All checks passed`.
- Frontend: `npm run build` -> success (Vite warning about the existing large
  894 kB chunk); `npm run lint` -> success.
- MED-02: `tests/test_suggested_range.py` -> **7 passed**, Ruff/build/lint OK.
- MED-03: `tests/test_draft_override.py` -> **3 passed**, build/lint OK.
- MED-06: `tests/test_audit.py` -> **10 passed**, Ruff OK.
- Full backend without the solver, first attempt: **179 passed, 1 failed**. A regression
  in the persistence of the MED-03 warnings (`test_manual_correction_survives_a_reload`):
  the response after the correction had warnings, the reload did not. Fixed by
  deterministically recomputing the warnings from the stored assignments on every
  `_schedule_response`; re-verification below.
- Persistence regression test + override: **4 passed**, Ruff OK.
- Full backend without the expensive `tests/test_scheduler.py`, after the fix:
  **180 passed** in 25.00 s.
- Generator frontend: **14 passed**, build and lint OK.

## Exit criterion

All items 13-19 of the report (MED-01..MED-06 and SEC-01) are implemented and
verified. The stage can safely be considered finished.
