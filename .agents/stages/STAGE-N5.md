# Stage N5 - Low-severity defects

Status: **done** (2026-09-06)

## State

- [x] LOW-01 - publication changes the generated prefix „Szkic ” to „Grafik ”.
- [x] LOW-02 - the availability legend is hidden for a viewer.
- [x] LOW-03 - the „Tylko do odczytu” label for a viewer/link.
- [x] LOW-04 - the decorative gradient and blur of the top bar removed.
- [x] LOW-05 - absolute changes below 0,05 described as „bez istotnej zmiany”.
- [x] LOW-06 - with zero eligibility days the table shows „nie pełni tej
  roli”, instead of an apparent balance of 0 → 0.
- [x] LOW-07 - the substitute options fetch the impact forecast, are sorted from the
  largest improvement of the chosen role's balance and get the „poprawia bilans” marker.
- [x] LOW-08 - no alarming `!` outside the published range.
- [x] LOW-09 - own duties that collide with a hard unavailability have a red
  marker and are sorted before the others.
- [x] LOW-10 - the wordmark does not wrap on a narrow screen.
- [x] LOW-11 - the fairness screen explains the priority of the weekend lens; the monthly
  report already explained that for staffing such a holiday is counted as a holiday.

## Verification

- First UI batch (LOW-02/03/04/08/10): build + lint OK; calendar and generator
  tests **25 passed**.
- LOW-05/06: build + lint OK; generator **14 passed**.
- LOW-01 + the blocking unavailability/publication: backend **8 passed**, Ruff OK.
- LOW-09 and UI regressions: build + lint OK; calendar, generator and swaps
  **33 passed**.
- LOW-07/11, first attempt: build and lint OK; **32 passed, 1 failed** because of a
  decorative chip appended to the option's accessible name. The chip was marked
  `aria-hidden`, so the option name stays the person's stable name.
- LOW-07/11 after the accessibility fix: **33 passed**, lint OK.
- Full frontend: **82 passed** in 11 files. The earlier React `act(...)` warnings
  in the `useGridNavigation` tests remain, with no failing tests.

## Exit criterion

LOW-01 to LOW-11 are implemented. Build, lint and the full frontend test suite are
green; stage finished.
