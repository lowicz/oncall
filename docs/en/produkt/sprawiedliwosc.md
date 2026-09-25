# Fairness

The fairness report answers one question: **is the split of duties even, and
if not - by how much and in which direction.**

## What is counted

- **Only duties actually served**, from published and superseded schedules.
  Drafts do not count at all.
- **A rolling 12-month window**, ending on the reference day.
- Every slot is counted from the **effective version of the schedule**, that
  is after overrides and approved swaps. Points go to the person who actually
  served the duty, not to the one originally assigned.
- A day covered by two publications counts **once**.

## Points

| Day type | Points |
| --- | --- |
| working day | 1 (X) |
| Saturday, Sunday, public holiday | 2 (2X) |

The multipliers do not stack. `PRIMARY` and `SECONDARY` get the same X or 2X.

## Lenses

Five categories balanced **separately**:

| Lens | Scope |
| --- | --- |
| `PRIMARY` | duties in the primary role |
| `SECONDARY` | duties in the supporting role |
| `11–19` | working-day 11-19 shifts |
| Weekends | on-call duties on Saturdays and Sundays |
| Holidays | on-call duties on public holidays falling on working days |

The weekends lens covers Saturday and Sunday, the holidays lens - holidays on
working days, so **no day is counted in both at once**.

With `11–19` anchored to `PRIMARY` or `SECONDARY` the `11–19` lens remains
informational, because its assignments follow from the anchor role. With the
“Independent of on-call” anchoring it is balanced by the solver on a par with
the others.

## Fair share

The expected share is **proportional to the number of days of the person's
eligibility in the window**, not to the number of people in the team. A person
eligible for half of the window has an expected share half as large.

The consequence for new people: someone who has just joined the rotation
**starts with a neutral balance**. The system does not create a debt for the
period before their eligibility and does not try to “catch up” on the whole
year with more duties. From the day they join they get a share proportional to
the currently available pool.

## How to read it

The **Fairness** screen (`/sprawiedliwosc`) states the criterion and its
result right in the subtitle: “12 months to 30 Sep · 5 people · criterion:
nobody beyond ±2.0 pts from share” with a **MET** or **NOT MET** badge.
Below it a row of badges with the numbers the coordinator counts in their head
anyway: the spread of each lens with a verdict, the average points per person
and the average weekend days. Hovering over the badge of a lens that does not
meet the criterion names the highest and the lowest person.

The **Team** section is a single table: for each person the deviation from
share as a two-way bar (above share to the right, below to the left), then
**Total** and each lens as `served / share` in the numeric columns.
The links in the section header (**Total**, `PRIMARY`, `SECONDARY`, `11–19`,
**Weekends**, **Holidays**) change only the sorting and which lens the bar
shows. A role the person does not hold shows “does not hold this role” instead
of numbers; a low result of a person who joined the rotation during the window
carries the note “in the rotation since”.

The arrow at the end of a row expands the person: points month by month as
bars against their monthly average, the numbers in words, the deviation on
each lens, the list of duties that make up the result and what the generator
will do with it. **Export CSV** saves the table; **As of** moves the end of
the window - by default to the end of the last publication, so duties already
scheduled count too.

The coordinator and the administrator see the whole team; a team member sees
only themselves (a summary of their own result is also on the Mine screen).

## Effect on the next generation

A positive difference (above share) reduces, and a negative one increases, a
person's share in the next generated range - but **at a limited rate**. In
one range the generator corrects a person's share by at most **half of their
share in that range** on each lens. In a month where the fair share is
5 `PRIMARY` points, a person with a surplus will get about 2.5 of them, a
person with a deficit about 7.5, and everyone keeps all kinds of duties.
Debt larger than this limit **does not disappear in one range**: the following
generations repay it, piece by piece, until the report is back within the
criterion.

Without this limit a year of uneven history was repaid in full in one month:
every duty went to the most indebted, and the rest of the team got nothing or
only one kind of duty. Limiting the rate turns such “all or nothing” months
into an evening out spread over several ranges.

This is still a soft influence:

- it is not a guarantee,
- it does not break eligibility, availability or the continuity rules,
- it works only as far as the “Equal share” weight allows.

Setting that weight to `0` switches evening out off entirely.

The forecast next to a draft distinguishes inherited debt from a defect of the
draft: when the lenses outside the criterion were outside it before the draft
too, the panel says so outright and gives the lowest spread achievable in this
range - see [Acceptance criterion](generator.md#acceptance-criterion).
