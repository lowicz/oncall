# Troubleshooting

When reporting a problem, give the application's version number: it is at
the bottom of the navigation rail, at the end of the account menu under the
avatar, and on a phone on the “More” screen. The version `dev` means an
instance built from the repository, not from a release.

## Signing in

**“Wrong username or password”**
Check the username. The same message appears for a disabled account - if the
credentials are definitely correct, contact the administrator.

**“Directory sign-in is temporarily unavailable”**
The application could not complete the sign-in in the directory (AD). Local
accounts keep working. The administrator will find the cause in the API log -
see [Directory sign-in](../wdrozenie/ldap.md#diagnostics).

**A directory account stopped letting you in after linking**
Once a local account is linked with the directory, the local password stops
working. Use your domain credentials.

**Identity conflict on the first sign-in from the directory**
The personnel number on the account does not match `employeeNumber` in the
directory. The administrator corrects the number on the “People” screen; the
event is in the audit as “LDAP identity conflict”.

**“Session expired” above the sign-in form**
The session ended while the tab was open: the session lifetime ran out, a
sign-out happened in another tab, or the administrator disabled the account.
The application then discards the loaded data and shows the sign-in at the
same address; after signing in you return to the screen that was open.

**Too many sign-in attempts**
Signing in is temporarily blocked (“Sign-in blocked (too many attempts)” in
the audit). Wait a while and try again.

## Date fields

**The field does not accept the typed date**
Date fields are browser fields: they accept only existing dates, in the
layout the field suggests. A non-existent date (for example `31-09`) is not
entered - correct the entry or pick the day from the browser's calendar.

**A “from-to” range was rejected**
The end date cannot be earlier than the start date. Where a form has a range,
the “To” field does not let you pick an earlier day; ultimately the server
checks this and rejects the save.

## Generator

**“The solver used up its time budget without a complete schedule”**
The time budget was too short. Raise the “Time budget per solver pass” in the
“Generator settings” panel (5-300 s) or reduce the draft's range. Remember
that one generation runs several passes, so the total time is a multiple of
the budget.

**An infeasible result - no solution**
The hard rules contradict the staffing. The screen gives the specific
conflicts. Typical causes:

- too few people eligible for the role on a given day,
- overlapping “Unavailable” entries,
- a weekend block that nobody can take in its entirety,
- `11–19` required from a person without eligibility under a hard anchor.

The fix is to change the **input data** (eligibility, availability, range),
not the weights - the weights cannot switch off a hard rule.

**A warning that the spacing rules were suspended**
The staffing and absences made it impossible to meet the limit of 3 duties in
7 days or the two-day rest. The solver built the schedule by the remaining
rules and says so plainly. The schedule is valid, but the load is uneven - it
is worth adding people to the rotation.

**Two runs give different schedules**
That is by design. Parallel CP-SAT finds different solutions of the same
quality. What is guaranteed is compliance with the rules and the acceptance
criterion, not a particular arrangement of names.

**Publication rejected - incomplete coverage**
Publication requires staffing on every day of the range. Fill in the missing
cells with a manual correction and try again.

**Someone changed the schedule in the meantime**
The screen will show what has changed and ask for confirmation. That is
optimistic locking at work - it protects against silently overwriting someone
else's change.

## Swaps

**I cannot pick a replacement**
The list contains only people who are eligible, available and do not hold
the opposite role that day. A person marked “not possible: …” is blocked by a
hard rule.

**“Date passed”**
The day of the request is already past. A decision cannot be made
retroactively - the coordinator fixes such a day with a correction on the
matrix.

**The request covered two slots instead of one**
The “11–19 anchor” setting makes both roles on that day belong to one person.
The screen announces this before sending; one acceptance (and, where
required, one approval) handles the whole thing.

## Schedule and matrix

**No `11–19` on a Saturday or Sunday**
As the rule says: this shift occurs only on Polish working days. It is not a
gap in the staffing.

**I filed availability and the schedule did not change**
Availability affects the schedule at the **next** generation that covers
those days. For an already published schedule use a [swap](zamiany.md).

**A new person has few duties**
The fair share is proportional to the eligibility period. A person who joined
the rotation recently has a correspondingly smaller share and does not
“catch up” on the year before.

## Notifications and calendar

**The e-mail did not arrive**
Notifications are queued in the database and sent by a separate worker
process. Without a configured SMTP server the messages are marked `skipped`
with a reason. Also check that the account has an e-mail address filled in
(the “People” screen).

**The calendar does not show a change**
Calendar applications refresh subscriptions at their own pace, usually every
few hours. A duty carries the schedule version as its sequence number, so
after a refresh the entry is updated, not duplicated.

**The ICS address stopped working**
It has been revoked. Create a new one on the “Mine” screen.

## Preview link

**The link does not work**
It may have expired (30 days at most) or been revoked - revocation takes
effect immediately. The administrator issues a new one.

**The link shows fewer days than it should**
A session from the link sees the schedule cut down to the link's date range.
The range is visible on the bar above the schedule.
