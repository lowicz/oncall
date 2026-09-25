# Product overview

## What it is for

The maintenance team is on duty outside working hours. Without a tool the
schedule is built in a spreadsheet: laying it out takes hours, nobody can show
that the split is even, and swapping a single day takes a conversation and a
manual fix in several places at once.

On-call has three goals:

1. **Shorten schedule preparation** - the coordinator gives a date range and the
   solver lays out staffing that meets the hard rules.
2. **Make the split measurable** - everyone sees how many duties they have served
   and what share would be due to them.
3. **Allow safe changes after publication** - swapping a single day does not
   recompute the rest of the schedule and leaves a trace in the audit.

## What the application handles

Each day has three independent assignments:

| Assignment | When it occurs | Who |
| --- | --- | --- |
| `PRIMARY` | every day | one person eligible for this role |
| `SECONDARY` | every day | a different person than `PRIMARY` |
| `11–19` | only on Polish working days | a person eligible for this shift |

A single day is always a separate assignment, even in weekly mode. This makes
it possible to swap a single day without touching the rest of the week.

## Glossary

| Term | Meaning |
| --- | --- |
| **duty (on-call)** | the staffing of one role on one day |
| **eligibility** | a person's entitlement to hold a given role over a given date range |
| **availability** | a person's entry: “Unavailable”, “Prefer not”, “Willing” |
| **draft** | the generator's result; binding on nobody |
| **publication** | the moment from which the schedule is in force and visible to everyone |
| **override** | a manual correction of one slot of a published schedule |
| **swap** | a request for a replacement on a specific day and role |
| **2X** | the double point rate for a Saturday, Sunday or public holiday |
| **lens** | a category balanced separately: `PRIMARY`, `SECONDARY`, `11–19`, weekends, holidays |

## Schedule lifecycle

```
draft ──► proposed ──► published ──► superseded
  ▲           │
  └───────────┘  (back to draft)
```

- **draft** - a fresh result of the generator. The coordinator can correct
  individual cells, delete the draft or generate another one.
- **proposed** - a draft submitted for approval. Its content is frozen.
- **published** - the schedule is in force. From this moment everyone sees it,
  including viewer accounts, and changes happen through swaps and corrections.
- **superseded** - a schedule replaced by a newer publication covering its
  range. The duty history remains countable.

Every transition checks the expected schedule version (optimistic locking), so
two people will not silently overwrite each other.

## The workflow in a month

1. People file their availability for the coming period.
2. The coordinator generates a draft (at most 35 days per run).
3. The coordinator looks at the fairness forecast and corrects individual cells.
4. The draft goes for approval and then for publication.
5. Publication sends out notifications and updates the ICS feeds.
6. Individual days change through swaps or the coordinator's corrections.
7. At the end of the month the coordinator downloads the CSV report for HR.

## What the application does not do

- It does not place calls or switch phone numbers - it only sends a reminder
  to switch.
- It does not replace working time records; the monthly report is an input to them.
- It does not integrate with Slack or Teams; e-mail is the notification channel,
  and the notification model is ready for further channels.
- It does not settle disputes: the soft rules are preferences, not guarantees.
