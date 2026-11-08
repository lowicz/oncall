# Administration

The screens used from time to time sit in the navigation rail under the
**Coordination** (history import, monthly report) and **Administration**
(people, events, share links, number forwarding, audit) sections; on a
phone under the **More** tab. Which items are visible depends on the role - see
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
**Pending** - a single Tab stop from the keyboard, where the arrow keys change
the filter. **Export CSV** saves the visible rows, **New account** opens the
panel for creating a local account.

Clicking a person (or **Open**) opens a panel with three tabs:

- **Account** - first name, last name, username (not editable), personnel
  number, e-mail and phone; the phone is required for people in the rotation,
  because the “On duty now” strip and the on-call card show it. The number
  is stored as `+48` and nine digits (bare digits get the prefix, spaces and
  dashes are dropped); a foreign number, or one stored before this rule, is
  marked “fix the number” in the table, and in the field once it is left or
  saved. Everyone can also
  change their own number on the [Mine](dostepnosc.md#my-phone) screen,
- **Rotation** - “Entry from” and “Exit on”, one **Qualifications** list
  (for each role its current and future periods or a “no qualification” row
  with an **Add** button, past periods last as history) and the **End the
  rotation…** button (see below). Every period lies inside the rotation, so a
  later entry date cannot be saved while some period starts earlier: the
  “Entry from” field then names its role, and a period start moved in the
  same save is saved before the new date. A badge in the panel header shows
  the rotation state,
- **Access** - the account role, the “Account enabled” switch and, for a
  local account, a **one-time** password reset link or - as long as the
  account is awaiting activation - a new activation link.

The open person and tab, the search typed and the filter are part of the page
address (`/osoby?osoba=<id>&karta=rotacja`, tabs `konto`, `rotacja`, `dostep`;
`szukaj=<text>`, `filtr=w-rotacji`, `poza-rotacja`, `wylaczone`,
`oczekujace`), so refreshing the page keeps the panel open and the list the
same, and a link opens it straight away.

An account without a rotation has an **Add to the rotation** button with an
entry date on the Rotation tab. The activation link of a new account is shown
once, after creation; pass the link on to the person through a secure
channel.

A new account can join the rotation straight away: the **In the duty
rotation** field in the “New local account” panel reveals the entry date,
the phone (then required) and the duty qualifications to select. The “After
creation” box says from when and in which roles the person will get duties.
After creation the same panel shows what was created (the account, the
rotation and the roles), the activation link and the **Open the rotation**
button, which leads to that person's Rotation tab. If the server refuses to
save the rotation or some of the qualifications, the account and the link
stay, the panel says what was not saved and why, and you finish the rest on
the tab.

Every qualification change waits for **Save**, like the other fields of the
panel, and joins the list of unsaved changes: **Edit** changes a period's
dates, **End today** ends the period as of yesterday (the published schedule
stays, the generator skips the role from the next run), a period that has not
started yet has **Delete** instead, and **Add period** and **Add** next to a
missing role add a new period. A changed row is marked “changed, unsaved”
(or “deleted”, “new”) and has a **Restore** button. After saving, ending or
deleting a period shows a message with an **Undo** button, which puts the
previous dates back or creates the deleted period again.

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
button. On a click the panel shows the new link at once, valid for 24 hours;
this person's earlier activation links stop working, and an “Activation link
issued” entry remains in the audit. The button is disabled for a disabled
account - enable it first. An account that already has a password gets a
password reset instead (a link valid for an hour, also issued without a
question; this person's sessions end only once the new password is set). Like
every link to an account, pass the new link on to the person through a secure channel; the
application does not send it.

The personnel number matters with a directory (LDAP / AD): it must match
`employeeNumber` for the local account to link automatically on the first
sign-in from the directory. In [SSO sign-in](../wdrozenie/sso.md) it picks the
account Keycloak lets the person into.

The panel keeps track of unsaved changes: the **Save** button gives their count.
Trying to close it (Esc or the cross), open another person, go to another screen, or reload requires a decision whether to discard the entered changes.
The **Discard changes** button in the footer drops them at once, without asking.
Every save ends with a notification in the corner of the screen that says what was saved (“Saved: phone”); so do creating an account and adding to the rotation.
A role change and disabling or enabling the account save without an extra question, and the notification (“Role changed: Jan Kowalski → Coordinator”) has an **Undo** button that puts the previous role and account state back for a few seconds.

### Leaving the rotation

Setting “Exit on” ends the rotation. The duty history **stays** and still
counts in the reports; only the assignment of new duties after that date
ends. Duties already published after that date have to be rewritten, so they
cannot be left unstaffed by mistake: the hint under the “Exit on” field gives
their number, and **Save** with such a date saves the account changes and the
entry date and opens the end-of-rotation dialog, which picks a replacement for
each duty. **Save** opens the same dialog when qualifications run past the exit
date, because no period may reach outside the rotation; the hint under the
field then says that saving ends them. The exit date is saved only in that dialog; closing it leaves the
date on the list of unsaved changes. Qualification changes wait too, because
the server does not let a qualification end while published duties still need
it: the dialog itself closes the periods on the exit date, and whatever is
left of those changes is saved by the next **Save** - the periods end on the
exit date at the latest, and those that would start after it leave the list. The **End the rotation…**
button on the Rotation tab opens the same dialog, with the date from the “Exit
on” field or, when it is empty, today's; without duties the dialog only closes
the qualifications and saves the exit date.

In the dialog the **The same replacement for all** field puts one person into
every duty that person can take; each row can then be changed on its own. Next
to every name, in brackets, is the number of duties that person already has on
the days of the duties being rewritten, and the least loaded are at the top.
The replacements get an e-mail, and the operation goes into the audit as “End
of rotation” with the person's name. The dialog has one red button that names
the effect, for example **Rewrite 6 duties and end the rotation** (with no
duties to rewrite: **End the rotation**). A click checks the hard rules for
all schedules at once and, when nothing is broken, saves straight away. If the
chosen replacements would break a hard rule, the dialog lists the violations
under the heading “The rewrite would break hard rules”: pick other
replacements or tick that you are breaking the rules deliberately, and click
the same button. A confirmed violation goes into the audit log. If an error
interrupts the save after some schedules were rewritten, the dialog says how
many duties are already rewritten; another click rewrites the rest. When it is
done, a notification gives the number of rewritten duties and the replacements
(“Marek Nowak ×3, Jan Wiśniewski ×1”) with an **Open schedule** button.

### Deleting an account and its personal data

The **Delete account…** button in the panel footer opens a red sheet with a
list of effects: the account is disabled immediately, the personal data
removed, the duty history and points stay for fairness, and this person's
published duties after today will be left unstaffed. The operation is
confirmed by **typing the person's username** (the field only hints “type the
username”, never the username itself); until then the button is
disabled. It cannot be undone. Afterwards the notification gives the
pseudonym under which the person stays in the schedule (“In the schedule:
Deleted person #…”).

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
this person use only the pseudonym. These entries are still subject to the
log's ordinary retention (see the “Audit” section below).

## Calendar events (`/wydarzenia`, administrator)

An information layer laid over the matrix: a name, a date range and a
colour.

Events **change neither the schedule, the rates nor the reports**. They serve
to mark context, for example a production change window or a freeze.

The “Show from” and “Show to” fields narrow the list below; “From” and “To”
in the form are the range of the event itself.

**Delete** - here and in the day panel on the schedule - deletes the event at
once, without a question. The “Deleted “…”” notification has an **Undo**
button that brings the event back for a few seconds, with the same name,
colour and whole date range.

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

**Undo import** next to an earlier import removes its duties from the history
for good, so it first asks in a dialog with the number of rows that will
leave the balance (“Undo the import “history 2025”? 312 rows will leave the
balance.”). This cannot be reversed; the data come back only by importing
the file again.

## Monthly report (`/raporty`, coordinator)

1. Pick the report month (`MM-YYYY`); the screen opens on the previous month.
2. Look at the preview - one row per person. The first, highlighted columns
   are the duty days (primary and secondary together): on working days, on
   weekends and holidays, and in total. 11-19 shifts are not duty days and
   have their own column.
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

## Number forwarding (`/przelaczanie`, administrator)

Automatic forwarding of the on-call number through Orange WCO to the phone
of the person on PRIMARY duty; how it works is described in
[Integrations](../produkt/integracje.md#on-call-number-forwarding-orange-wco).
The screen has two parts: the WCO account and the state. Times are in
`Europe/Warsaw`.

### WCO account

The **WCO account** form stores the details the worker process logs in to
the WCO panel with:

- **Mode** - **Off** (the default; the worker does not connect to WCO and
  you switch the number by hand), **Dry run** (the worker logs in, reads the
  number and records in the audit trail what it would set, but changes
  nothing in WCO) or **On** (the worker switches the number and changes an
  expired WCO password itself). The chosen mode is described under the
  field.
- **WCO address** - `https` only, `https://wco.orange.pl` by default.
  Changing the address means entering the password again, so that a stored
  password never reaches another server.
- **Switchboard number**, **Login** and **WCO user id** - the panel's login
  details and the WCO user whose number is the forwarding target.
- **WCO password** - stored encrypted under `ONCALL_SECRETS_KEY`
  ([Getting started](../wdrozenie/uruchomienie.md)). A stored password never
  comes back into the form: in its place are the date of its last change and
  the **Change password** and **Show password** buttons (see [Switching the
  number by hand](#switching-the-number-by-hand)). Without the key in the
  environment no password can be stored and forwarding cannot be turned on;
  the screen then says which variable to set.

Dry run and on need the full set: the switchboard number, the login, the
user id and the password. A save goes to the audit trail as "Zmieniono
przełączanie numeru" (without the password) and clears the worker's pending
failures, so after corrected settings the worker tries at once.

**Check connection** logs in to WCO with the stored details and reads the
number WCO forwards to now, changing nothing; it works in every mode, **Off**
included, and needs the full set of stored details. The result is one of:
the connection works (with the number WCO holds); the password has expired
(the login works, but WCO wants the password changed - in **On** mode the
worker does that itself); WCO refused the login details; could not connect
(with the name of the failed call and the HTTP status, never WCO's response
body); configuration unavailable (`ONCALL_CA_FILE` names no readable file).
Every check goes to the audit trail as "Sprawdzono przełączanie numeru".

Once WCO has refused the stored passwords (the **State** card then shows
"Passwords refused"), the worker stops logging in so as not to lock the WCO
account, and **Check connection** is disabled for the same reason. Entering
a new password in the **WCO password** field lifts the stop.

### State

The **State** card shows what the worker left after its last pass: the
target (the person on PRIMARY, their number and the duty day), the number
WCO forwards to as last confirmed and when it was confirmed, the last
attempt and its outcome (switched, unchanged, failed, skipped for want of a
person on PRIMARY or of a number, dry run with nothing changed), the error
text, since when it has been failing, the number of failed attempts and the
time of the next one, and also the date of the last WCO password change, a
password change under way and refused passwords. The history of the passes
is in the [Audit](#audit-audyt-administrator) under the actions "Przełączono
numer on-call", "Nie udało się przełączyć numeru", "Pominięto przełączenie
numeru" and "Zmieniono hasło WCO".

While the number is handed over, the card starts with a **Handover** row: who
gave the number, who receives it, until when, and who started the handover
and when. **End** ends it at once, without asking, and the number returns to
the person on PRIMARY.

### Switching the number by hand

When automatic forwarding fails - the "Numer on-call" alert mail arrives or
the State card shows a failure - you switch the number by hand in the WCO
panel. For that you need the password of the WCO account, which only the
application knows, because in **On** mode the worker changes it itself when
it expires.

1. If a number set by hand is to stay, set the mode to **Off** and save: in
   **On** mode the worker overwrites a number other than that of the person
   on PRIMARY at the next switch
   ([Going live](../wdrozenie/przelaczanie-numeru.md#going-live)); until
   then the manual number stays. Switching to that person's own number is
   harmless - the worker sees the number already set and records
   "unchanged".
2. Click **Show password** and enter **your own application password** in
   the dialog (a directory account, LDAP / AD, confirms it in the directory).
   A wrong password counts as a failed sign-in and is subject to the same
   throttle as the sign-in screen. The reveal goes to the audit trail as
   "Odsłonięto hasło WCO": who and when, never the value.
3. The password is masked; the eye icon reveals it and **Copy** puts it on
   the clipboard. It leaves the screen after 60 seconds or when the dialog
   closes, and is stored nowhere in the browser.
4. Sign in to the WCO panel with the switchboard number, the login and that
   password, and set the number of the WCO user named in the settings.

While an automatic password change is under way the dialog shows two
passwords: the new one first ("Try this one first"), then the previous one
("If WCO does not accept it"), in the same order the worker tries them. Once
WCO has refused the stored passwords the dialog warns that the password was
probably changed outside the application; once you know the right one,
enter it in the **WCO password** field.

If the WCO panel forces a password change during a manual sign-in, the
stored password goes stale: the worker's next login is refused, the
refusal is recorded and an alert goes out. So do not change the password in
WCO unless you must, and if you must, enter the new one in the **WCO
password** field at once.

A directory administrator confirms their password in the directory, so when
LDAP and forwarding fail together only a local administrator can reveal the
WCO password. Keep the account from `python -m oncall.seed_admin`, with its
password in the organisation's vault.

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

The log has a limited retention, which the screen states in its footer:
entries about operations are removed after a year, routine sign-ins after 90
days (the deployment's administrator can change both ages or switch them
off). That includes the entries about schedule corrections: whom a
correction replaced, the schedule keeps on the duty itself. An entry removed
by retention does not come back, so older history is kept by the CSV export.
