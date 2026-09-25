# Schedule generator

The generator is a CP-SAT model (OR-Tools) run in a separate worker process,
not in the API process. Thanks to this, a long computation does not block the
application: the progress is visible on the screen and the other screens work
normally.

## Two tiers of rules

The solver first **satisfies all hard rules**, and only then optimises the
soft objectives. It never breaks a hard rule silently - if the set of rules is
contradictory, it shows the specific conflicts.

### Hard rules

- full `PRIMARY` and `SECONDARY` coverage of every day in the range,
- `PRIMARY` ≠ `SECONDARY` on the same day,
- `11–19` only on Polish working days,
- eligibility for the role and day,
- a filed “Unavailable”,
- an indivisible weekend and holiday block,
- the limit of 3 duties in 7 days and 2 days' rest after a run (outside weekly
  mode; suspended with an explicit warning when they are infeasible),
- `11–19` anchoring for people eligible for both roles.

### Soft objectives

Three normalised families of objectives, optimised in a single pass. Only
**the ratio between the weights** matters, not their absolute values: 6 / 4 / 2
works the same as 3 / 2 / 1.

| Weight | Default | What it does |
| --- | --- | --- |
| **Equal share** | 3.0 | evens out the distribution and penalises outliers convexly |
| **Team preferences** | 2.0 | respects “Prefer not” and “Willing” |
| **Rotation continuity** | 1.0 | limits hand-overs within a week |

A value of `0` switches the given objective term off entirely - including
“Equal share”, which is not a preference. No weight can switch off a hard rule.

## Rotation modes

| Mode | Behaviour |
| --- | --- |
| **Hybrid** (default) | rewards continuity of the week, but breaks the block for hard rules or a significant imbalance |
| **Daily** | does not reward continuity |
| **Weekly** | picks a base Monday-Sunday pair, but records seven separate daily assignments |

In every mode the final record is **daily assignments**, so a single day can
later be swapped without disturbing the rest of the week.

## Range and suggestion

- One run covers **at most 35 days**. A longer period is split into
  consecutive, overlapping drafts.
- Without an explicit range the generator starts from the first day not covered
  by a published schedule and proposes an end on the Sunday closing four full
  Monday-Sunday weeks (28-34 days in total).
- A range opened deliberately from the calendar takes precedence over the suggestion.
- The draft name contains the rotation mode and the range in `DD-MM-YYYY` format.
- A single-day range is accepted, but there is nothing to balance on it: the
  result is the staffing of a day, not a schedule. The screen signals this.

## Acceptance criterion

Measured in a rolling twelve-month window ending on the last day of the draft,
on the `PRIMARY`, `SECONDARY`, weekends and holidays lenses:

- **acceptance criterion: 3 points** of deviation spread,
- **optimisation target: 2 points**.

The limit of 3 accounts for indivisible 2X weekend blocks. The `11–19` lens is
subject to the criterion only with the “Independent of on-call” anchoring; with
anchoring its distribution is only a tie-breaker in the objective.

The criterion is computed for the whole window, so **inherited debt** - an
imbalance inherited from history - can make it unachievable in a single range.
The generator repays such debt at a limited rate (at most half of a person's
share per range, see [Fairness](sprawiedliwosc.md#effect-on-the-next-generation)),
so it does not try to close the whole difference at the cost of an “all or
nothing” month. Instead of failing silently it then reports **the lowest
spread achievable in this range** - a number determined for the full window,
not capped from above - and in the warning points out that the cause is
history, not the quality of the generation. When the criterion is within reach
of the range but the repayment rate does not close it, the warning says that
the next range will finish evening out. When it is the staffing, eligibility or
the rules that do not allow going below the threshold, the warning names that
cause instead of the debt.

The solver and the fairness report compute the same window and the same
history - a mismatch between them was a source of a bug in the past, so both
paths use a single slot resolution.

## Time budget

The budget is a field of the scheduling policy (5-300 seconds, 15 by default),
editable only in the application, in the “Generator settings” panel. No
environment variable sets or overrides it.

The budget applies to **one solver pass**. One generation runs several of
them - a model that has to prove that the acceptance criterion is unachievable
is solved repeatedly - so the upper limit of the whole generation is
correspondingly higher. The screen shows both numbers.

The number of parallel CP-SAT threads follows from the CPU allocation of the
worker container (in Compose: 2 CPUs), with a limit of 8. It can be overridden
with the `ONCALL_SOLVER_WORKERS` variable.

## Repeatability

Identical input **does not have to** give identical assignments: parallel
CP-SAT may find different solutions of the same quality. What is guaranteed is
the quality of the result against the rules and the criterion, not a specific
arrangement of names.

## Fairness forecast

Next to the draft matrix there is a forecast: for each person the balance
before the range, the balance after taking the current version of the draft
into account, and the change. The forecast is recomputed after generation and
after every manual correction of a cell. It remains a forecast - it does not
replace the report of duties actually served.
