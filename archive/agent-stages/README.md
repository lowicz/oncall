# Implementation stages - QA-REPORT-4 and the blocking problem

Each stage has its own file with a state ("done", "in_progress", "pending").
Before taking up work, the next model first reads this file, then the file of the given stage.

## Index

| Stage | File | State | Last change |
| --- | --- | --- | --- |
| N1. Unblocking the solver | `STAGE-N1.md` | done | 2026-09-06 |
| N2. Solution quality | `STAGE-N2.md` | in_progress | 2026-09-06 |
| N3. Data integrity | `STAGE-N3.md` | done | 2026-09-06 |
| N4. Closing the medium defects | `STAGE-N4.md` | done | 2026-09-06 |
| N5. Minor | `STAGE-N5.md` | done | 2026-09-06 |
| BD-01. Hard unavailability in the draft lifecycle | `STAGE-BLOCKING.md` | done | 2026-09-06 |

## How to resume

1. Copy the stage into your own session: read `archive/docs/QA-REPORT-4.md` (chapter 11
   contains the itemised remediation plan) and the stage file.
2. Carry out the remaining items, updating the stage file as you go.
3. Verification commands: `cd backend && uv run --extra dev python -m pytest tests/test_scheduler.py -q`
   and the full suite `uv run --extra dev python -m pytest -q` (the solver can be heavy:
   usually ~2 min for the solver tests alone).
