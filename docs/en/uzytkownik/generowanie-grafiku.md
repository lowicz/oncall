# Generating the schedule

The **Generator** screen (`/generator`) is available to the coordinator and
the administrator. The generator's result is a **draft** and does not replace
the published schedule until you deliberately publish it.

## Before you generate

Check three things - correcting them after generation costs more:

1. **The team and eligibility** are up to date (the “People” screen).
2. **Availability** has been filed for the period you want to cover.
3. **History** has been imported, if you are running the application for the
   first time - without it the balance starts from zero and the first
   schedule has nothing to even out.

## New draft

The generator's start page has a **New draft** form with the **From** and
**To** fields and the **Create draft** button, and below it the **Drafts**
list. The **Generator settings** button in the header opens a side panel with
the settings (described below).

- Without an explicit range the fields are filled with a suggestion: the first
  day not covered by the published schedule and the Sunday that closes four
  full weeks.
- A range opened from the calendar takes precedence over the suggestion.
- **At most 35 days** per run. Split a longer period into consecutive,
  overlapping drafts.
- A single-day range is accepted, but the screen will warn that there is
  nothing to balance on a single day.

Below the fields you can see the saved settings (the rotation mode and the
`11–19` anchor) and a note if you have unsaved changes in the settings panel.

The **Drafts** list shows the existing drafts with their state (`DRAFT`, `FOR
APPROVAL`), version, number of assignments and creation date. **Open** goes
to the proposal, the bin icon deletes the draft. If you have drafts in both
the daily and the weekly mode, the expandable section **Compare the daily and
weekly variants** sets their metrics side by side before you choose the one
to publish. When there is only one draft of each mode, the section picks both
straight away and compares them; with several you choose a pair and click
**Compare**.

## While it is computing

The solver runs **outside the API process**, so while it computes you can use
the other screens. The screen title changes to “Generating *range*”, and the
progress panel shows:

- the stages **data**, **solver**, **fairness**, **proposal** and the status
  (`Queued…` or `Generating…`),
- a seconds counter together with the budget **per solver pass** and the
  total generation limit - a hard schedule needs several passes, so a counter
  exceeding the budget of a single pass is not a defect,
- a warning if unstaffed days remain before the draft starts.

After a page refresh the view of a generation in progress resumes by itself -
**do not start it a second time**.

## Proposal

An open draft is a separate page. The title says what stage the result is at:
“Draft *range*”, “Proposal *range*” after submission for approval, “Schedule
*range*” after publication. Below the title are: the state badge, the
version, the number of assignments and days, the rotation mode and the solver
status (`CP-SAT: OPTIMAL` and the like; a status other than a complete
solution is explained in words - most often it means that the time budget was
too short or that the hard rules contradict the staffing). Further down, the
row of cycle stages (Draft, For approval, Published) and the **Draft state**
in four badges: staffing, hard rules, soft warnings and the points spread
after publication.

Actions in the header: **Generator settings**, **Regenerate**, and then
**Submit for approval** for a draft or **Back to draft** and **Publish…** for
a proposal.

The page has two columns. On the left:

- **Proposed staffing** - a people × days matrix, in the same convention as
  the published schedule: the headers keep the weekday, the holiday and 2X;
  the **Legend** link explains the marks.
- **Problems** - a table of everything that needs attention before
  publication: duties on an “Unavailable” day, broken hard rules, solver
  warnings, gaps before the draft and a note that the draft is out of date.
  The **By person** / **By rule** switch groups the rows, **Hard only** hides
  the soft warnings, and the **Fix** button on a row opens the right cell of
  the matrix. The table footer lists the hard rules and leads to their full
  description.

On the right:

- **Fairness after publication** - the points spread as a single number with
  the value from before the draft and a **better** / **worse** badge, the
  acceptance criterion on every lens, a table of people with their deviation
  after publication and a verdict. It is recalculated after each of your
  corrections, so you see the effect of a decision before passing the
  schedule on. The verdict tells two situations apart: when the lenses
  outside the criterion were already outside it before the draft, that is
  **inherited historical debt** - the draft repays it at a limited pace, and
  the panel says by how much it reduces the spread and what spread is
  achievable in this range at all; neither correcting cells nor regenerating
  will remove that debt. When, on the other hand, a lens that fit within the
  criterion before the draft exceeds it after publication, that is a defect
  of the draft, and then it is worth correcting the cells or generating
  again.
- **Settings of this proposal** - the range, version, rotation mode, `11–19`
  anchor, weights and solver budget; **Change and regenerate** opens the
  settings panel.

The **Drafts** list is also below the proposal, so you switch between drafts
without going back to the start page.

### Manual cell correction

Click a cell, pick the role and the person in the day panel, save. A
correction:

- does not regenerate the remaining days,
- is subject to the hard rules,
- uses versioning,
- is marked as manual,
- does not mark the draft as out of date: that warning concerns only changes
  outside the draft, e.g. availability entered after generation.

## Generator settings

The **Generator settings** button opens a side panel with the **From** /
**To** range and the solver settings. **Save generation settings** saves them
**globally for the whole team**; they apply from the next generation.
**Generate** starts a generation right away with the range from the panel,
and **Restore saved** reverts the unsaved changes.

| Setting | Range | Notes |
| --- | --- | --- |
| Rotation mode | hybrid / daily / weekly | weekly mode switches off the limit of 3 duties in 7 days and the two-day rest |
| `11–19` anchor | `SECONDARY` / `PRIMARY` / independent | hard for people eligible for both roles |
| Equal share | 0-100 | the highest priority by default |
| Team preferences | 0-100 | the middle one by default |
| Rotation continuity | 0-100 | the lowest by default |
| Time budget per solver pass | 5-300 s | 15 by default |
| A duty swap requires the coordinator’s approval | on / off | on by default; off writes the swap into the schedule as soon as the replacement accepts, and coordinators only get a notification ([Swaps](zamiany.md#coordinator-approval)) |

The weights change the **relative** priority of the soft rules: 6 / 4 / 2
works the same as 3 / 2 / 1. A value of `0` switches the given objective term
off. The weights **cannot** switch off eligibility, unavailability or the
required coverage.

Weekly mode shows a separate warning with the measured effects (12-day runs,
windows with more than three duties) - switch it on deliberately.

## Publication

```
Draft ──► For approval ──► Published
```

1. **Submit for approval** - the content of the draft is frozen and the title
   changes to “Proposal”.
2. **Publish…** - opens the “Publishing the proposal v*N* · *range*” sheet
   with a list of effects: how many assignments become the schedule, what
   happens to the earlier schedules, how many soft warnings go to the audit
   as accepted and how many pending swaps will be cancelled. If the range has
   already started, you additionally have to tick that the team will see the
   change immediately. The **Publish v*N*** button publishes; **Back to the
   proposal** closes the sheet without changes. Publication checks the full
   coverage of the range; missing staffing on any day stops the operation.
3. The schedule becomes visible to everyone, notifications go out, and the
   ICS feeds get updates.

If in the meantime someone has changed the schedule or an approved swap
collides with the draft, the publication sheet lists every such case with a
**Decision** field, in which you choose which version is to apply - only then
does it publish. A proposal can also be taken back with the **Back to draft**
button or deleted from the list of drafts.

Publication replaces only those published schedules that fit entirely within
the new range; a partial overlap is resolved per slot, and the coverage
outside the new range is kept.
