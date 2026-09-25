# Schedule model

## Day, role, slot

The smallest unit is a **slot**: one day and one role. A 30-day schedule
is 30 `PRIMARY` slots, 30 `SECONDARY` slots and as many `11–19` slots as there
are Polish working days in that period.

Hard rules about slots:

- Every day has exactly one `PRIMARY` and one `SECONDARY`.
- `PRIMARY` and `SECONDARY` on the same day are always **different people**.
- `11–19` occurs **only on Polish working days**. On Saturdays, Sundays and
  public holidays it is neither generated nor possible to add by hand.
- A slot can only be staffed by a person with valid eligibility for that role and that day.
- A person who has filed “Unavailable” for a day will not be assigned to it.

## Daily coverage

The default duty windows in the `Europe/Warsaw` zone:

| Day type | Window |
| --- | --- |
| working day | 19:00-09:00 the next day |
| Saturday, Sunday, public holiday | around the clock |

The `11–19` shift covers 11:00-19:00 on a working day.

## Eligibility

Eligibility is a **period**, not a flag: a role plus a start date and an
optional end date. The same person can be eligible for `PRIMARY` from January,
for `SECONDARY` from March, and for `11–19` not at all.

Consequences:

- A person joining the rotation in the middle of the year has no “debt” for the
  period before their eligibility - see [Fairness](sprawiedliwosc.md).
- Ending eligibility does not erase history; past duties still count.
- A person without `11–19` eligibility does not block the anchor role.

Rotation (membership of the duty team) is a separate period: “Entry from”
and an optional “Exit on”.

## Availability

A team member files date ranges of three kinds:

| Kind | Label | Strength |
| --- | --- | --- |
| `unavailable` | **Unavailable** | **hard rule** - the solver will not staff that day |
| `prefer_not` | Prefer not | soft preference - the solver avoids it but may assign |
| `prefer` | Willing | soft preference - the solver prefers it |

The reason is optional and private: it is seen by the author of the entry and
by the coordinator and the administrator. The coordinator and the
administrator can file availability on behalf of another person; the person
gets a notification about it and can remove the entry.

## Days off and the 2X rate

The calendar of Polish holidays comes from the `holidays` library and is the
same for the solver, the fairness report and the monthly report - there are no
two definitions of holidays that could drift apart.

- A working day = **1 point (X)**.
- A Saturday, Sunday or public holiday = **2 points (2X)**.
- The multipliers **do not stack**: a holiday on a Saturday is still 2X, not 4X.
- A holiday falling on a weekend counts once. In the monthly report it goes to
  the weekend category; in the fairness lenses weekend and holiday never
  count the same day twice.

Weekends and holiday blocks are a hard block rule: the solver assigns the whole
block to one person in a given role. A block can only be split by hand - by a
coordinator's correction or by a swap after publication.

## Spacing of duties

In daily and hybrid mode:

- at most **3 on-call duties in any 7 consecutive days** for one person,
- at least **2 days' rest** after a run of at least two days,
- a second duty of the same person in the same ISO week is additionally
  penalised softly.

These rules **do not apply in weekly mode** - a week with one person could
not be staffed then. If the staffing and absences make it impossible to meet
the spacing rules, the solver suspends them, lays out the draft according to
the remaining rules and shows an explicit warning instead of staying silent.

## Anchoring the 11–19 shift

The “11–19 anchor” setting has three values:

| Value | Meaning |
| --- | --- |
| Same person as `SECONDARY` | default |
| Same person as `PRIMARY` | |
| Independent of on-call | `11–19` balanced like a separate role |

For a person eligible for both roles the match is **hard**. A person without
`11–19` eligibility does not block the anchor role - the deviation is penalised
softly and visible in the generator's result. Hard unavailability and
eligibility always take precedence over anchoring.

## Calendar events

The administrator can place informational events (name, date range, colour)
on the matrix. They are only a visual marker: **they change neither the
schedule, the rates nor the reports** and do not affect the solver.

## Corrections and swaps after publication

- **Coordinator's correction (override)** - the coordinator or the administrator
  changes the assignment in one cell without the replacement's consent and
  without an additional approval step. It records an override, uses versioning
  and applies only to the chosen day and role. The hard rules are checked
  before saving, but they do not block the correction unconditionally: in an
  emergency the coordinator can **deliberately** break them. A correction that
  breaks a hard rule goes through only with an explicit acknowledgement - in
  the API the field `acknowledge_rule_violations: true`; without it (or with
  `false`) the request ends with a `409` response listing the violations and
  changes nothing. An acknowledged violation goes to the audit log as a
  “deliberate rule violation” together with the rule identifiers. The batch
  correction when ending a rotation works the same way.
- **Swap** - a team member's request, which needs the replacement's consent
  and, when the team requires it, the coordinator's approval too (the switch is
  described in [Swaps](../uzytkownik/zamiany.md#coordinator-approval)). It can
  cover one role and day, both roles of a day, a range or a whole week. Writing
  a swap into the schedule creates an override and **does not regenerate the
  other days**, and the points go to the person who actually serves the duty.

Publishing a new schedule is serialised in the database, checks full coverage
and supersedes only those published schedules that fit entirely within the new
range. Partial overlap is resolved per slot, and coverage outside the new
range is kept.
