# Administration

The screens used from time to time sit in the navigation rail under the
**Coordination** (history import, monthly report) and **Administration**
(people, events, share links, audit) sections; on a phone under the **More**
tab. Which items are visible depends on the role - see
[Roles and access](../produkt/role-i-dostep.md).

## People (`/osoby`, administrator)

Below the title is a tally of the accounts: how many there are, how many
people are in the rotation, who is joining it and when, how many accounts have
been disabled and how many are awaiting activation. The **Accounts** table has
the columns an administrator actually reads: the person with their e-mail,
the username with the personnel number, the account role, the rotation (`IN
THE ROTATION` with the entry date and qualifications, `FROM 12 OCT` for a
person who is only about to join, `ended`, “outside the rotation”), the phone
(a missing one for a person in the rotation is red, because the “On duty now”
strip needs it) and the sign-in method (local or LDAP / AD, and for a local
account without a password the `AWAITING ACTIVATION` badge - see below). The
section header has a search field (person, username, number, phone) and the
filters **All**, **In the rotation**, **Outside the rotation**, **Disabled**,
**Pending**. **Export CSV** saves the visible rows, **New account** opens the
panel for creating a local account.

Clicking a person (or **Open**) opens a panel with three tabs:

- **Account** - first name, last name, username (not editable), personnel
  number, e-mail and phone; the phone is required for people in the rotation,
  because the “On duty now” strip and the on-call card show it,
- **Rotation** - the rotation state, **duty qualifications** as chips
  (removing a chip ends the role's period as of yesterday, so the published
  schedule stays and the generator skips the role from the next run; adding
  a chip opens a period from today), “Entry from” and “Exit on”, and the list
  of **qualification periods** where the dates can be edited and a period
  added,
- **Access** - the account role, the “Account enabled” switch and, for a
  local account, a **one-time** password reset link or - as long as the
  account is awaiting activation - a new activation link.

An account without a rotation has an **Add to the rotation** button with an
entry date on the Rotation tab. The activation link of a new account is shown
once, after creation; pass the link on to the person through a secure
channel.

### Accounts awaiting activation

A new local account has no password until the person opens the activation
link and sets one; until then they cannot sign in, although the account is
enabled. Such an account has the `AWAITING ACTIVATION` badge in the “Sign-in”
column with the link's deadline: yellow and “activation link valid until …”
while the link works, red and “activation link expired …” (or “no valid
activation link”) once it no longer does. The same badge is in the header of
the person's panel, and the **Pending** filter shows only such accounts. The
badge is independent of disabling: an account disabled before activation has
both. Directory accounts (LDAP / AD) and accounts that already have a
password never have it. The CSV export gives this state in the `activation`
column.

On the **Access** tab of such an account there is an “Awaiting activation”
box with the link's deadline and the **Generate a new activation link**
button. After confirmation the panel shows the new link, valid for 24 hours;
this person's earlier activation links stop working, and an “Activation link
issued” entry remains in the audit. The button is disabled for a disabled
account - enable it first. An account that already has a password gets a
password reset instead (a link valid for an hour). Like every link to an
account, pass the new link on to the person through a secure channel; the
application does not send it.

The personnel number matters with a directory (LDAP / AD): it must match
`employeeNumber` for the local account to link automatically on the first
sign-in from the directory.

The panel keeps track of unsaved changes: the **Save** button gives their
count, and an attempt to close lists what would be lost. Changing the role
and disabling the account require an additional confirmation.

### Leaving the rotation

Setting “Exit on” ends the rotation. The duty history **stays** and still
counts in the reports; only the assignment of new duties after that date
ends. Duties already published after that date have to be rewritten - the
panel then shows the “Effect on the schedule” warning with the **Rewrite
future duties and end the rotation…** button, which picks a replacement for
each such duty. If the chosen replacements would break a hard rule, the
dialog lists the violations under the heading “The rewrite would break hard
rules”: pick other replacements or tick that you are breaking the rules
deliberately, and confirm again. A confirmed violation goes into the audit
log.

### Deleting an account and its personal data

The **Delete account…** button in the panel footer opens a red sheet with a
list of effects: the account is disabled immediately, the personal data
removed, the duty history and points stay for fairness, and this person's
published duties after today will be left unstaffed. The operation is
confirmed by **typing the person's username**; until then the button is
disabled. It cannot be undone.

The first name, last name, e-mail, phone and personnel number disappear from
the account. If the person was in the rotation, their place in the team
remains under the pseudonym **“Deleted person #…”** with the first six
characters of the team member identifier. Under it they appear in the
schedule, fairness, reports, calendar feeds and next to their past duties,
including those from a history import recorded under their first and last
name. Exception: if someone else in the team bears the same first and last
name, the imported duties with no person assigned stay under that name,
because they may belong to that person.

The audit is an exception to the deletion: earlier entries keep the person's
first and last name, and the **“Account deleted”** entry records in its
details their previous name and the pseudonym assigned. New entries about
this person use only the pseudonym.

## Calendar events (`/wydarzenia`, administrator)

An information layer laid over the matrix: a name, a date range and a
colour.

Events **change neither the schedule, the rates nor the reports**. They serve
to mark context, for example a production change window or a freeze.

The “Show from” and “Show to” fields narrow the list below; “From” and “To”
in the form are the range of the event itself.

**Delete** - here and in the day panel on the schedule - asks for
confirmation; a deleted event cannot be restored.

## History import (`/import`, coordinator)

1. Download the CSV template from the page or use `examples/history.csv`.
2. Fill in the columns `service_date` (`YYYY-MM-DD`), `role` (`primary`,
   `secondary`, `late_shift`) and `assignee_name` (the exact display name).
3. Save as **UTF-8**, at most 5000 rows.
4. Upload the file - you will first see a **preview** with the detected
   duplicates, unknown people and conflicts. The errors are ordered by row
   number, as in the file, so you fix it from top to bottom.
5. Confirm the import.

`late_shift` is accepted **only on Polish working days**; a row with this role
on a Saturday, Sunday or holiday will be rejected with the row number given.

The import feeds the history from which the fairness report and the
generator compute.

## Monthly report (`/raporty`, coordinator)

1. Pick the report month (`MM-YYYY`).
2. Look at the preview - one row per person.
3. “Download CSV”.

The screen warns if the published schedule does not cover the whole month,
and says how many days it covers. When the table does not fit on the screen
(e.g. on a phone), a hint appears above it and you scroll the table sideways;
the person column then stays in place. The columns are described in
[Integrations](../produkt/integracje.md#monthly-report-for-hr).

Every slot counts from the effective version of the schedule, after
corrections and swaps. A holiday that falls on a Saturday or Sunday counts
once, as a weekend.

## Share links (`/udostepnienia`, administrator)

Preview links for people without an account.

1. Give the **Recipient** (a label by which you will recognise whom the link
   serves).
2. Set the **Schedule from** - **Schedule to** range.
3. Choose the **Link validity**: 1, 3, 7, 14 or 30 days.
4. “Create link” and copy the address - it is shown only once.

Opening the link exchanges the one-time token for a limited preview session,
and the token disappears from the address bar. The session sees only the
published schedule cut down to the link's range.

**Revocation takes effect immediately** after confirmation - ongoing sessions
from that link stop working, and a revoked link cannot be restored.

The permanent form of access for a person outside the rotation is a named
`viewer` account; a temporary link is the exception.

## Audit (`/audyt`, administrator)

A log of significant operations, newest at the top, times in the
`Europe/Warsaw` zone.

Filters: action, person, text search and a date range. Routine sign-ins are
hidden by default - the “Show routine sign-ins” switch turns them on; the
screen reminds you of this when you filter by person or text.

The filter result can be exported to CSV.

The audit record is created in **the same transaction** as the change itself,
so there are no changes without a trace. The actor label is stored verbatim,
so an entry survives the deletion of the account and also describes an actor
who is not a user, for example a preview link.
