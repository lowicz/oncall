# Integrations

## E-mail notifications

Swap lifecycle events, schedule publications, coordinator's corrections and
reminders to switch the number **write a row to the `notification_outbox`
table in the same transaction as the business change**. A separate worker
process drains the queue with exponential back-off and delivers the messages
through channel providers.

Consequences of this shape:

- A notification cannot “vanish” when the mail system fails - it stays in the queue.
- A business change cannot succeed without the notification being created (or the other way round).
- The channel is an extension point: today `email`; further channels plug into
  the same queue without touching the business logic.

Delivery is **at least once**. The worker process claims a batch under a
lease, sends each message without an open transaction and records each result
separately, so a process that dies midway repeats at most one message - never
a whole batch. Each message carries the queue row identifier as a stable
idempotency key, which the SMTP provider emits as a fixed `Message-ID`, so a
repeat is recognisable as the same message.

The SMTP server is an **external service** - the project does not host mail.
Without a configured SMTP host, messages are marked `skipped` with the reason
recorded in the queue.

Every message goes out in two versions at once (`multipart/alternative`): as
plain text, which says everything on its own, and as HTML in the application's
light theme - with the same role marking (PRIMARY, SECONDARY, 11–19), the
same colours and dates in the form `czw 24-09-2026` that the screens show.
The HTML version is written for Outlook 365: a table layout, styles inlined
into the elements, no web fonts, images or transparency. The name and subtitle
in the message header come from `ONCALL_APP_NAME` and `ONCALL_APP_SUBTITLE`,
and the buttons lead to `ONCALL_PUBLIC_BASE_URL`.

A coordinator's correction - single or batch (e.g. when ending a rotation) -
notifies both sides of every rewritten slot: the person taken off and the one
taking over. With a batch correction each person gets one message listing only
the slots they gave up or took over, together with the reason for the
correction.

The schedule publication message goes to every team member active in its
range. It lists only their own duties (day and role) or says that there is
none in this schedule, and leads to the **Mine** screen (`/moje`).

## ICS feeds

Calendar applications subscribe to revocable token addresses under `/calendar`.

| Feed | Who creates it | Content |
| --- | --- | --- |
| personal | team member (the “Calendar subscription (ICS)” section on the “Mine” screen) | only their own duties |
| for a share link | administrator | the schedule cut down to the link's range and validity |

Duties are all-day events, and **the schedule version is the event's sequence
number**, so calendar applications see corrections and swaps as updates of an
existing entry, not as new entries.

A feed can be revoked at any moment; the address stops working immediately.

## Share links

Described in [Roles and access](role-i-dostep.md#temporary-access-without-an-account):
a link tied to a recipient, a date range and an expiry of up to 30 days,
exchanged for a limited preview session.

## History import

The coordinator and the administrator upload a UTF-8 encoded CSV (up to 5000 rows).

Required columns:

| Column | Format | Notes |
| --- | --- | --- |
| `service_date` | `YYYY-MM-DD` | duty date |
| `role` | `primary`, `secondary`, `late_shift` | `late_shift` only on Polish working days |
| `assignee_name` | the person's exact display name | must exist in the team |

The preview before the import detects duplicate slots, unknown people and
conflicts. A ready example is in `examples/history.csv`, and a template for
download is on the import screen.

The import feeds the history from which fairness and the generator compute, so
it is a way to start the application with a sensible balance from day one.

## Monthly report for HR

The coordinator and the administrator download a CSV for the chosen month. One
row is one person. UTF-8 encoding with BOM, a stable and versionable column
layout:

| Column | Meaning |
| --- | --- |
| `miesiac` | settlement month (`YYYY-MM`) |
| `osoba` | display name |
| `primary_dni_robocze` | `PRIMARY` duties on ordinary working days |
| `primary_weekendy` | `PRIMARY` duties on Saturdays and Sundays |
| `primary_swieta` | `PRIMARY` duties on public holidays |
| `secondary_dni_robocze` | as above, for `SECONDARY` |
| `secondary_weekendy` | |
| `secondary_swieta` | |
| `oncall_dni_robocze_razem` | total on-call on working days |
| `oncall_weekendy_razem` | total on-call on weekends |
| `oncall_swieta_razem` | total on-call on holidays |
| `oncall_weekendy_swieta_razem` | duty days on weekends and holidays together (`PRIMARY` + `SECONDARY`) |
| `oncall_dni_razem` | all duty days (`PRIMARY` + `SECONDARY`, on working days plus weekends and holidays) |
| `zmiany_11_19` | number of working-day `11–19` shifts |
| `primary_punkty` | points for `PRIMARY` (X / 2X) |
| `secondary_punkty` | points for `SECONDARY` |
| `punkty_razem` | total points |

A duty day is one `PRIMARY` or `SECONDARY` duty; `11–19` shifts are not duty
days and only have their own column. Every slot is counted from the effective
version of the schedule, after overrides and swaps. A holiday falling on a
Saturday or Sunday is counted once, as a weekend. The screen warns when the published schedule does not cover the
whole month, and says how many days it covers.

Future formats (XLSX, Word) are to use the same reporting model, not separate
counting logic.

## Audit

Significant operations - sign-ins and failed sign-ins, availability changes,
the swap lifecycle, draft generation, publications, corrections, policy
changes, history imports, links and feeds, account administration - are
recorded in the `audit_events` table **in the same transaction as the change
itself**.

The actor label is denormalised, so the trail survives the deletion of an
account and also describes actors that are not users, for example a share
link. The administrator browses and filters the log on the “Audit” screen, and
can export the filter's result to CSV.

## Worker process metrics

The worker process reports on its own logger `oncall.metrics`, one logfmt
record per measurement. None of it goes to the database, and the API process
emits none of these records - the value of these numbers is the value of the
worker process's logs, so they are worth collecting.

| Record | Fields |
| --- | --- |
| `queue` | `queued`, `running`, `oldest_queued_seconds`, `stalest_running_seconds` |
| `outbox` | `eligible`, `oldest_eligible_seconds`, `retrying`, `attempts_max`, `waiting`, `dead` |
| `generation` | `run`, `outcome`, `queued_seconds`, `run_seconds` |
| `generation_abandoned` | `runs` - how many runs were released after a process that died (a warning) |

`queue` and `outbox` are sampled on a clock (`ONCALL_METRICS_INTERVAL_SECONDS`,
60 by default) regardless of whether anything is happening - **a gap in them
means that the worker process itself has stopped**.

`outcome` takes the values: `completed`, `infeasible` (the staffing and the
hard rules are contradictory - the input data must change),
`requester_missing`, `error` (an application defect) and `reclaimed` (the
solve finished after the run was deemed abandoned, so the result was
discarded; `ONCALL_STALE_RUN_SECONDS` is too tight for this staffing).
