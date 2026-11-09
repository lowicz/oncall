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
**To** fields and the **Generate the next range** button, and below it the **Drafts**
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
- a seconds counter together with the time of **one attempt** and the total
  generation limit - a hard schedule needs several attempts, so a counter
  exceeding the time of a single attempt is not a defect,
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
state pill. Only a draft has a number (“Draft · v2”, it grows with every
correction); after submission the pill says “For approval”, after publication
“Published”, because a publication is named by its date, not by a number. Below the title are the
number of assignments and days and the rotation mode. The header actions are
**Generate a new draft** and the **⋯** (**More**) menu with **Generator
settings**. **Generate a new draft** creates another draft for the same range
and opens it; the open schedule, with its corrections, stays as it is, which
the message after generating says.

Above the matrix there is **one decision panel**:

- **the verdict** - the number of hard rule violations and the state of the
  fairness criterion (met, missed, or missed through **an imbalance from before
  the draft**),
- **why** - the people on duty on an “Unavailable” day who block the publication,
  with the role and the day; with an incomplete solver solution, a hint to
  click a cell with a gap and enter a person; under it the points spread
  before and after the draft,
- **one main action**: on a draft with hard problems **Fix *N* problems**
  opens the cell of the first one (a duty on an “Unavailable” day or a
  broken rule), and a note under the button says what comes next: **then:
  Submit for approval**. When the draft only breaks rules, the **⋯** menu
  (**Other actions**) has **Submit for approval** and **Publish…** for a
  coordinator who breaks them knowingly; a duty on an “Unavailable” day
  leaves neither. A clean draft leads with **Publish…**, and its **⋯** menu
  has **Submit for approval** for teams where a second person checks the
  draft. A proposal has **Publish…** next to **Back to draft** (a proposal
  with a duty on an “Unavailable” day has only **Back to draft**).

On a proposal the panel also has a **What the publication changes** frame:
how many changes will be carried over, how many pending swaps cancelled, how
many entries changed since generation and how many soft warnings go to the
audit. An expandable list names the carried changes and the cancelled swaps.
You see this before you open the publication sheet.

Under the panel one row of badges sums the draft up: staffing, soft warnings
(a click opens the **Problems** tab) and the roles, weekends and holidays
gathered into two groups, those meeting the fairness criterion and those
missing it.

Further down, **Proposed staffing** - a people × days matrix, in the same
convention as the published schedule: the headers keep the weekday, the
holiday and 2X, and a day missing `PRIMARY` or `SECONDARY` has its header
marked as a gap; the **Legend** link explains the marks. From the keyboard the
matrix is a single Tab stop, as the published schedule is: you move across the
cells with the arrow keys, `Home` and `End` jump to the beginning and end of
the row, `PageUp` and `PageDown` jump a week, and `Enter` opens the day panel.

Under the matrix there are four tabs:

- **Problems** - a table of everything that needs attention before
  publication: duties on an “Unavailable” day, broken hard rules, solver
  warnings, gaps before the draft and a note that the draft is out of date.
  The **By person** / **By rule** switch groups the rows, **Hard only** hides
  the soft warnings, and the **Fix** button on a row opens the right cell of
  the matrix: for a duty on an “Unavailable” day that duty, for a broken hard
  rule the person's duty on the first day the rule concerns. Rows about the
  whole draft (solver warnings, gaps, the draft being out of date) have no
  single cell, so they have no button. A duty on an “Unavailable” day blocks
  the publication, and a broken hard rule needs consent in the publication
  window. The table footer lists the hard rules and leads to their full
  description. On a phone the table becomes a list of cards: the kind, the
  person with the day and role, the detail, and the button under it.
- **Fairness** - the points spread as a single number with the value from
  before the draft and a **better** / **worse** badge, the verdict under it,
  then the acceptance criterion in every role, on weekends and on holidays and
  a table of people with their deviation after publication. It is recalculated
  after each of your corrections. The verdict tells two situations apart: when
  a role, the weekends or the holidays were already outside the criterion
  before the draft, that is an **imbalance from before the draft** - the
  generator evens it out a little at a time, and the panel says by how much the
  draft reduces the spread and what spread is achievable in this range at all;
  neither correcting cells nor regenerating will remove that imbalance. When,
  on the other hand, a role, the weekends or the holidays that fit within the
  criterion before the draft exceed it after publication, that is a defect of
  the draft, and then it is worth correcting the cells or generating again.
- **Settings** - what the draft remembers: the range, version, rotation mode,
  the solver's result in words - “optimal solution”, “best found within the
  time limit” or “no complete solution” - and the fairness quality. The
  **Solver details** link next to the result shows the engine's status
  (`CP-SAT: OPTIMAL` and the like) and the gap to the best possible solution.
  The weights, the `11–19` anchor and the solver budget are team settings with
  one place: **Change the settings and generate…** opens the settings panel.
- **Drafts** - the list of drafts, so you switch between them without going
  back to the start page.

### Manual cell correction

Click a cell; the day panel (titled “Insert: *person* · *day*”) opens on every
role of the cell, e.g. SECONDARY and `11–19` together. The **Roles to change** group works as in the day inspector of the
published schedule: PRIMARY and SECONDARY exclude each other, and `11–19` is
ticked from the start when the `11–19` coupling binds it to the ticked role and
its current holder has both; a day off has no `11–19`. The person in the
clicked row takes the ticked roles. Under the group a preview shows, role by
role, who holds it now and who will after the correction, then that person's
balance in each role; **Assign in the draft** saves it, with two roles
**Assign in the draft (2 roles)**. When there is nothing to insert, the
button is off and the reason stands under the group: the person already holds
those roles (then click the cell of the person who should take them over, or
use **Swap places…**), cannot take one of them, e.g. no eligibility for
`11–19` or the other on-call that day, or is marked “unavailable”, which the
frame above the group says. What is ticked stays, so untick a role or click another person's
cell. A correction can also fill a role the solver left empty: click any empty
cell of a day marked as a gap, and the panel opens on the empty role and shows
“unstaffed → *person*”.

When the day's PRIMARY and SECONDARY are held by different people, the panel
also has **Swap places…**. The “Swapping places” frame shows both roles after the
swap and, when the policy binds `11–19` to the role given up by the person who
also holds `11–19`, a “together with SECONDARY” (or “together with PRIMARY”)
box, ticked when the other person is eligible for `11–19`; unticking it leaves
`11–19` unchanged. In a
draft the swap checks no hard rules in the frame and sends no e-mail: what it
breaks shows in the problems table. **Swap places** saves both roles (and
`11–19`) as one correction. Every correction, a swap included:

- does not regenerate the remaining days,
- is subject to the hard rules,
- uses versioning,
- is marked as manual,
- does not mark the draft as out of date: that warning concerns only changes
  outside the draft, e.g. availability entered after generation,
- ends with a notification saying what changed and how many problems are left
  in the draft; its **Undo** button puts the previous people of every changed
  role back for a few seconds (the cells stay marked as manual). The button is
  missing when the previous person of a role is no longer in the team, e.g.
  after their rotation ended or their account was deleted, when they cannot
  take the role back that day (they are unavailable or not eligible for it),
  and after filling an empty role - then correct the cell again or generate
  the draft anew.

## Generator settings

The **Generator settings** button opens a side panel with the solver
settings. It is the one place where you change them; they are saved
**globally for the whole team** and apply from the next generation. The panel
does not edit the range, it only states it (“The generation covers …”): the
range from the **New draft** form or the range of the open draft. The footer
has one main button: without changes **Generate** starts a generation right
away, and with unsaved changes **Save and generate** saves them and generates
in one click. Only with changes do **Save**, which only saves, and the arrow
icon (**Restore saved**), which reverts them, appear. The **How the weights work** link explains how the weights
behave. Under a separate **Swap policy** heading is the switch for
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

1. **Publish…** on a clean draft submits it for approval in the background,
   checks the effects of the publication and only then opens the “Publishing
   the draft · *range*” sheet. Closing the sheet without publishing
   (**Back to the draft**) or moving to another draft or screen takes the submission
   back, so the draft stays as it was. A failed submission or check shows in
   the decision panel, and the draft returns to where it was before the
   click. **Submit for approval** in the **⋯** menu freezes the
   content of the draft without publishing it, and the title changes to
   “Proposal”; **Publish…** in the decision panel then publishes the
   proposal in the “Publishing the proposal · *range*” sheet.
2. The sheet checks the publication again each time it opens, and while
   open it checks again when you return to the browser tab; while it is
   checking it says so next to the buttons and **Publish** waits. The
   sheet holds: one sentence of effect (how many assignments become the
   schedule, an e-mail to the team, the ICS feeds updated, undone
   only by a new publication), the same **What the publication changes**
   frame as the proposal page (carried changes, cancelled swaps, entries
   changed since generation, warnings to the audit), and under it what has to
   be settled: the conflicts with changes with a “To settle” counter, the consents and - if
   the range has already started - a box saying the team will see the change
   immediately. Hard rule violations get one frame per broken rule, titled
   with that rule (“Publication will break a rule: …”), with a checkbox “I
   understand and knowingly break this rule”; a gap before the schedule has
   its own frame with the checkbox “I understand that these days stay
   unstaffed”. Next to the buttons
   the sheet says what is still missing (“To settle: 1 conflict, 2
   consents.”), and **Publish** works only when nothing is.
   **Back to the proposal** closes a sheet opened from a proposal without
   changes. Publication checks the full
   coverage of the range; missing staffing on any day stops the operation.
3. The schedule becomes visible to everyone, notifications go out, and the
   ICS feeds get updates. The “Published *range*” notification says
   the same and has an **Open schedule** button.

Submitting for approval from the **⋯** menu and returning to the draft end
with a notification with the range too (“Sent for approval: 4 – 31 Oct”).
The background submission and taking it back when the sheet is closed have
no notification.

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
