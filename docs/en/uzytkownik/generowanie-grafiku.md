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
to the proposal, the bin icon deletes the draft after a confirmation that says how many manual
corrections are lost with it. If you have drafts in both
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

### Events on the draft

The draft matrix shows calendar events in the same way as the published schedule.
A dot in the event colour appears in every cell for that day, and the event name is also available to screen readers.
When you open a day, its panel lists the events with colour swatches.
The list is read-only - add and edit events on the **Events** screen.

## Proposal

An open draft is a separate page. The title is the range, and next to it one
state pill with the version: “Draft · v2”, “For approval · v3” after
submission, “Published · v4” after publication. Below the title are the
number of assignments and days and the rotation mode. The header actions are
**Generate a new draft** and the **⋯** (**More**) menu with **Generator
settings**. **Generate a new draft** creates another draft for the same range
and opens it; the open schedule, with its corrections, stays as it is, which
the message after generating says.

Above the matrix there is **one decision panel**:

- **the verdict** - the number of hard rule violations and the state of the
  fairness criterion (met, missed, or missed through **inherited debt**),
- **why** - the people on duty on an “Unavailable” day who block the hand-off,
  with the role and the day; with an incomplete solver solution, a hint to
  click a cell with a gap and enter a person; under it the points spread
  before and after the draft,
- **one main action**: **Fix *N* problems** opens the first clashing cell
  (then **Submit for approval**), on a clean draft **Submit for approval**,
  and on a proposal **Publish v*N*…** next to **Back to draft**.

On a proposal the panel also has a **What the publication changes** frame:
how many changes will be carried over, how many pending swaps cancelled, how
many entries changed since generation and how many soft warnings go to the
audit. An expandable list names the carried changes and the cancelled swaps.
You see this before you open the publication sheet.

Under the panel one row of badges sums the draft up: staffing, soft warnings
(a click opens the **Problems** tab) and the fairness lenses gathered into two
groups, those meeting the criterion and those missing it.

Further down, **Proposed staffing** - a people × days matrix, in the same
convention as the published schedule: the headers keep the weekday, the
holiday and 2X, and a day missing `PRIMARY` or `SECONDARY` has its header
marked as a gap; the **Legend** link explains the marks.

Under the matrix there are four tabs:

- **Problems** - a table of everything that needs attention before
  publication: duties on an “Unavailable” day, broken hard rules, solver
  warnings, gaps before the draft and a note that the draft is out of date.
  The **By person** / **By rule** switch groups the rows, **Hard only** hides
  the soft warnings, and the **Fix** button on a row opens the right cell of
  the matrix. The table footer lists the hard rules and leads to their full
  description.
- **Fairness** - the points spread as a single number with the value from
  before the draft and a **better** / **worse** badge, the verdict under it,
  then the acceptance criterion on every lens and a table of people with their
  deviation after publication. It is recalculated after each of your
  corrections. The verdict tells two situations apart: when the lenses outside
  the criterion were already outside it before the draft, that is **inherited
  historical debt** - the draft repays it at a limited pace, and the panel
  says by how much it reduces the spread and what spread is achievable in this
  range at all; neither correcting cells nor regenerating will remove that
  debt. When, on the other hand, a lens that fit within the criterion before
  the draft exceeds it after publication, that is a defect of the draft, and
  then it is worth correcting the cells or generating again.
- **Settings** - what the draft remembers: the range, version, rotation mode,
  solver status, fairness quality and the solution gap estimate. The weights,
  the `11–19` anchor and the solver budget are team settings with one place:
  **Change the settings and generate…** opens the settings panel.
- **Drafts** - the list of drafts, so you switch between them without going
  back to the start page.

### Manual cell correction

Click a cell, pick the role and the person in the day panel, save. A
correction can also fill a role the solver left empty: click any empty cell of
a day marked as a gap, and the panel opens on the empty role and shows
“Currently: none → After correction: *person*”. A correction:

- does not regenerate the remaining days,
- is subject to the hard rules,
- uses versioning,
- is marked as manual,
- does not mark the draft as out of date: that warning concerns only changes
  outside the draft, e.g. availability entered after generation,
- ends with a notification saying who was replaced and how many problems are
  left in the draft; its **Undo** button puts the previous person back for a
  few seconds (the cell stays marked as manual). The button is missing when
  the previous person cannot be told apart, e.g. after their rotation ended,
  their account was deleted, or when several team members share the same
  name, nor after filling an empty role - then correct the cell again or
  generate the draft anew.

## Generator settings

The **Generator settings** button opens a side panel with the **From** /
**To** range and the solver settings. It is the one place where you change
them; they are saved **globally for the whole team** and apply from the next
generation. The footer has one main button: without changes **Generate**
starts a generation right away with the range from the panel, and with
unsaved changes **Save and generate** saves them and generates in one click.
**Save** only saves, and the arrow icon (**Restore saved**) reverts the
unsaved changes. Under a separate **Swap policy** heading is the switch for
the coordinator's approval of swaps; it does not affect generation.
Closing the panel, going to another screen, reloading, or opening another draft with unsaved settings requires a decision whether to discard them.
A “Generation settings saved” notification confirms the save.

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
2. **Publish v*N*…** in the decision panel opens the “Publishing the proposal
   v*N* · *range*” sheet. The sheet holds only what has to be settled: one
   sentence of effect (how many assignments become the schedule, an e-mail to
   the team, the ICS feeds updated, undone only by a new publication), the
   conflicts with changes with a “To settle” counter, the consents and - if
   the range has already started - a box saying the team will see the change
   immediately. Rest rule violations and a gap before the schedule each have
   their own frame with a checkbox (“I understand and knowingly break these
   rules”, “I understand that these days stay unstaffed”). Next to the buttons
   the sheet says what is still missing (“To settle: 1 conflict, 2
   consents.”), and **Publish v*N*** works only when nothing is. **Back to the
   proposal** closes the sheet without changes. Publication checks the full
   coverage of the range; missing staffing on any day stops the operation.
3. The schedule becomes visible to everyone, notifications go out, and the
   ICS feeds get updates. The “Published v*N* · *range*” notification says
   the same and has an **Open schedule** button.

Sending for approval and returning to the draft end with a notification with
the range too (“Sent for approval: 4 – 31 Oct”).

If in the meantime someone has changed the schedule or an approved swap
collides with the draft, the publication sheet lists every such case (the day,
the role, who is in the correction or the swap and who is in the draft) with a
**Decision** field: “Keep the correction: *person*” or “Keep the swap:
*person*” against “Keep the draft: *person*”. Only once all are settled does
the sheet publish. A proposal can also be taken back with the **Back to draft**
button or deleted from the list of drafts.

A publication error stays in the open sheet as an alert with the message and the next step.
A draft deletion error stays in the confirmation dialog that started the operation.

Publication replaces only those published schedules that fit entirely within
the new range; a partial overlap is resolved per slot, and the coverage
outside the new range is kept.
