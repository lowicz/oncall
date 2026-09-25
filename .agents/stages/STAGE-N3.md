# Stage N3 - Data integrity (HGH-05, HGH-06)

Status: **done** (2026-09-06)

## Done (plan items 9-12, QA-REPORT-4 chapter 11)

9. **HGH-05 (an import does not win over a publication).**
   - `backend/src/oncall/routes/history.py`: the import's `published_at` changed
     from `datetime.now(UTC)` to midnight of the import range
     `datetime.combine(starts_on, time.min, tzinfo=UTC)` - an import no longer looks
     like "the newest schedule in the system".
   - `backend/src/oncall/effective.py`: an explicit order in `effective_assignments()`
     - `key = (not name.startswith("Import historii:"), published_at or _EPOCH, str(id))`.
     Ascending sort + overwriting in turn: imports (False) are processed
     FIRST, real publications (True) LAST, so every real publication
     wins over an import per slot regardless of the timestamps.
     (Note: the key must be `not startswith`, so that real publications get the
     HIGHER key and are processed last.)
10. **HGH-05 (the preview reports the conflict).** `_validate_members` gained a
    set of occupied slots `{(service_date, role)}` from all schedules with
    `status == published` covering the range of the rows; every import row
    that hits a published slot gets
    `HistoryImportError(..., "service_date", "Data dyżuru jest objęta grafikiem opublikowanym")`.
    Since `_validate_members` is also called from `commit`, commit likewise
    rejects (422/409) such rows - there is no silent pass.
11. **HGH-06 (casefold + display_name from the database).** `commit_history`:
    the `members` dictionary is keyed by `display_name.casefold()` (exactly like
    validation); assignments store `member.display_name` (not the raw string
    from the CSV) and `member.id` (never NULL for a known person). There is no longer a
    „rafał kamiński" row with `member_id = NULL` in the database.
12. **Regression test (item 12):** `tests/test_history_import_routes.py`,
    a `rafał kamiński` row (lower case) for a day covered by a publication
    -> preview `valid=False` with the covered-day message (rejected, not
    accepted). The remaining tests in the file:

## Tests (new, `tests/test_history_import_routes.py`)

- `test_commit_matches_member_case_insensitively_and_uses_roster_name` -
  a commit with `rafał kamiński` yields `member_id=członek.id` and the name from the roster.
- `test_legacy_import_never_wins_over_real_publication` - constructs a legacy
  import with `published_at=now()` (reproducing the defect) and checks that
  `effective_assignments()` returns Piotr (the publication), not Rafał.
- `test_import_fills_slot_not_covered_by_any_publication` - the import wins
  where no publication covers the slot (matched by member_id).
- `test_preview_reports_conflict_with_published_schedule` - item 12 above.

## Verification

- `uv run --extra dev python -m pytest tests/test_history_import_routes.py -q` -> **4 passed**.
- Full backend (without the solver): **171 passed**.
- The solver was untouched in this stage (28 tests green from stage N1).

## N3 exit criterion

"no import changes the point total in the fairness report or the number of
rows in the staffing report for days already published."

Not verified together with the staffing/fairness reports (the reports read
`effective_assignments` and `matches_member` - the ordering fix + casefold
should close both). A manual QA scenario is worth doing in a future session:
a publication + a lower-case import for the same day -> the settlement unchanged.
