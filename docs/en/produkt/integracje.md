# Integrations

## E-mail notifications

Swap lifecycle events, schedule publications, coordinator's corrections,
duty-start notices and the coordinators' working-day message **write a row to the
`notification_outbox` table in the same transaction as the business change**. A separate worker
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
recorded in the queue. The application sends with a login or without one,
through a relay that trusts its EHLO name, see
[SMTP server](../wdrozenie/uruchomienie.md#smtp-server).

Every message goes out in two versions at once (`multipart/alternative`): as
plain text, which says everything on its own, and as HTML in the application's
light theme - with the same role marking (PRIMARY, SECONDARY, 11–19), the
same colours and dates in the form `czw 24-09-2026` that the screens show.
The HTML version is written for Outlook 365: a table layout, styles inlined
into the elements, no web fonts or transparency. The only image, the logo in
the header, travels inside the message itself (an inline `cid:` image), so it
shows outside the installation's network too and is not in the list of
attachments. The name and subtitle in the message header come from
`ONCALL_APP_NAME` and `ONCALL_APP_SUBTITLE`, and the buttons lead to
`ONCALL_PUBLIC_BASE_URL`.

A coordinator's correction - single or batch (e.g. when ending a rotation) -
notifies both sides of every rewritten slot: the person taken off and the one
taking over. With a batch correction each person gets one message listing only
the slots they gave up or took over, together with the reason for the
correction.

The schedule publication message goes to every team member active in its
range. It lists only their own duties (day and role) or says that there is
none in this schedule, and leads to the **Mine** screen (`/moje`).

Whoever starts a duty in any role - PRIMARY, SECONDARY or 11–19 - gets two
messages at `ONCALL_HANDOVER_REMINDER_HOUR` (Warsaw time, 9 by default): an
announcement on the last Polish working day before the first day of the duty
and a reminder on that first day itself. A duty starting on a Monday or at the
weekend is therefore announced on the Friday, and one starting after a holiday
on the last working day before it. The person handing the duty over gets no
message about it.

Consecutive days of the same role held by the same person are one duty: the
messages come only at its start and give its last day. For 11–19 the weekends
and holidays that have no such shift do not break the run. Moving from PRIMARY
to SECONDARY starts a new duty, and so another announcement and reminder.
Roles the same person starts on the same day (e.g. SECONDARY and 11–19) are in
one message, each with its own last day.

When PRIMARY is among the roles starting, the first-day reminder asks for the
on-call number to be switched and, if `ONCALL_SWITCH_URL` is set, its button
leads to the switching page. When automatic forwarding through Orange WCO
runs in `live` mode, that reminder goes out only once the worker has read
this person's number for the day back from WCO, and confirms the switch
instead of asking: „Numer on-call został przełączony na Twój telefon
+48 500 *** 500 o 09:00” (the on-call number has been switched to your
phone), with the number masked as in the alerts and the time WCO confirmed
it. When the switch fails, the reminder waits until it succeeds that day
(after a retry, a new password or a manual switch in the WCO panel) and the
person gets the alert meanwhile; a day without a switch passes without the
reminder. A correction that changes PRIMARY says in this mode that the number
switches itself and that the person taking over gets the usual first-day
reminder; the correction sends no separate confirmation. Each of the two
messages goes to a person at most once, so further worker passes during the
day duplicate nothing.

Every coordinator and administrator gets a message on every Polish working
day, at `ONCALL_COORDINATOR_DIGEST_HOUR` (Warsaw time, 8 by default), titled
“Dyżury na dziś” (today's duties): who holds PRIMARY, SECONDARY and 11–19
today, without phone numbers. It cannot be switched off. When days off follow
that day - a weekend, a holiday - the message covers them too, day by day, up
to the next working day: Friday's speaks of Friday, Saturday and Sunday, and
Thursday's before a Friday holiday of four days. Its subject is then like
“Dyżury od 9 do 11 października” (duties from 9 to 11 October) and it adds
that the schedule for the following days may still change. No message goes
out on a day off, an overdue one included. A role nobody holds is described as
“brak obsady” (unstaffed), and 11–19 on a day off as “brak dyżuru (dzień
wolny)” (no duty, day off). When no schedule is published for those days, the
message still goes out and says so plainly. If the worker was not running at
that hour, the message goes out later the same working day; each person gets
it at most once per working day, including a coordinator added after that
hour. Without a configured SMTP host this message is not queued at all,
so turning mail on sends no overdue messages for days gone by.

## On-call number forwarding (Orange WCO)

The on-call number is forwarded in the Orange WCO switchboard to the phone
of the person on PRIMARY duty. Every few seconds the worker process compares
the number the schedule calls for with the number WCO last confirmed, and
changes it when they differ. The duty day changes at the duty reminder hour
(`ONCALL_HANDOVER_REMINDER_HOUR`, 9 Warsaw time by default): before it the
number belongs to yesterday's PRIMARY, from it to today's, so the switch
lands in the same minute as the "you are on call today" reminder, which
confirms it in this mode, and a correction or a swap during the day changes
the number on the next pass.

The number comes from the phone on the person's account (`+48` and nine
digits), sent to WCO unchanged. The WCO account (address, switchboard
number, login, WCO user id, password) and the mode (off, dry run, on) are
set by an administrator on the
[Number forwarding](../uzytkownik/administracja.md#number-forwarding-przelaczanie-administrator)
screen. The password sits in the database encrypted under
`ONCALL_SECRETS_KEY`; without the key the feature cannot be turned on. A dry
run logs in, reads the number and records in the audit trail what it would
set, but changes nothing in WCO - it is the gate before turning it on.

When WCO reports an expired password, the worker in on mode sets a new one
itself (20 characters, four character classes), storing it first as pending
and only after a successful login with it as current, so an interrupted
pass never leaves WCO with a password the application does not know. When
WCO refuses every stored password, the worker stops logging in until an
administrator enters a new password, so as not to lock the WCO account.

Failures: a permanent error (a refused login, a refused number change,
nobody on PRIMARY, no number) at once, and a transient one (the network, a
server error) after 10 minutes of retries sends the "Numer on-call" e-mail to
the active coordinators and administrators and to the person on PRIMARY,
once a day per target: who should be receiving calls, what WCO forwards to,
what failed and what to do. When the switch succeeds after an alert, the
coordinators and administrators get a short recovery message. In dry run
mode no alerts go out. No message, audit entry or state carries a password,
a cookie or WCO's response body, only the name of the call and the HTTP
status.

The connection to WCO is always verified; a corporate CA is added from the
`ONCALL_CA_FILE` file ([Getting started](../wdrozenie/uruchomienie.md#ca-file)).
The history is in the audit trail under the `forwarding.*` actions
(switched, failed, skipped, password change, password reveal, connection
check, settings change), and the administrator's screen shows the current
state. Audit entries are subject to retention, which is why state needed
for ever sits on rows of its own. When the automation fails, an
administrator reveals the WCO password and switches the number themselves:
[Switching the number by hand](../uzytkownik/administracja.md#switching-the-number-by-hand).

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

The log does not grow without end: the worker process removes entries about
operations older than `ONCALL_RETENTION_AUDIT_DAYS` (365 days by default) and
routine sign-ins and refused attempts older than
`ONCALL_RETENTION_LOGIN_AUDIT_DAYS` (90 days by default). Schedule correction
entries follow the same age, because a republish reads whom a correction
replaced from the duty itself, not from the log. The “Audit” screen shows the ages in force;
the other tables and settings are described in
[Data retention](../wdrozenie/uruchomienie.md#data-retention).

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
| `retention` | `audit`, `logins`, `outbox`, `runs`, `sessions`, `tokens` - how many rows the pass removed; `capped` - how many tables reached the batch limit and still have a backlog; `seconds` |
| `forwarding` | `outcome` (`applied`, `unchanged`, `failed`, `skipped_no_primary`, `skipped_no_phone`, `dry_run`), `rotated` - `1` when the pass changed an expired Orange WCO password; `seconds`, `attempts` - consecutive failed attempts; a pass that did nothing emits no record |

`queue` and `outbox` are sampled on a clock (`ONCALL_METRICS_INTERVAL_SECONDS`,
60 by default) regardless of whether anything is happening - **a gap in them
means that the worker process itself has stopped**. `retention` appears every
`ONCALL_RETENTION_INTERVAL_SECONDS` (3600 by default), also after a pass that
removed nothing; `dead` in `outbox` counts the failed messages retention has
not yet removed.

`outcome` takes the values: `completed`, `infeasible` (the staffing and the
hard rules are contradictory - the input data must change),
`requester_missing`, `error` (an application defect) and `reclaimed` (the
solve finished after the run was deemed abandoned, so the result was
discarded; `ONCALL_STALE_RUN_SECONDS` is too tight for this staffing).
