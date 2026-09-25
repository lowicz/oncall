# My duties and availability

The **Mine** screen (`/moje`) answers a team member's three questions, in this
order: when am I on duty, what have I filed, how do I compare with the team.
The title of the screen is “My duties”, and under it: who, in which account
role, how many duties in the last 90 days and when the next one is. On the
right are two actions: **ICS export (mine only)** and **Propose a swap**
(opens Swaps with your nearest duty already selected).

On a wide screen the left column holds the duties and the availability
calendar, the right one the points and the swaps that involve you. On a phone
the sections follow one another: duties, points with the **File
availability** button, calendar, swaps.

## Upcoming duties

The list of duties in the next 60 days, one row per day: the day and the role
(two roles on the same day are in one row, for example `SECONDARY + 11–19`),
and underneath the coverage window, the rate (`1X` or `2X`) and who else is
on duty that day (`S Marek`). A duty under way today is highlighted and has a
**Details** button (opens that day on the Schedule); every other one has a
**Swap** button, which opens the Swaps screen with that duty already selected.
A day that collides with a filed “Unavailable” has an amber edge and the note
“collides with your unavailability”. The **Schedule** link in the section
header opens the matrix with your row highlighted.

## My availability

Availability is filed **on the month calendar**, without a form with dates.
The section header has a brush with four modes - **unavailable**, **prefer
not**, **willing** and **clear** - and arrows that change the month.

- Clicking a day saves that one day with the chosen mode.
- Dragging across days saves the whole range; Shift+click closes the range
  from the last saved day (useful from the keyboard).
- The **clear** mode removes the entry from the selected days. If the entry
  covered more days, the rest remain.
- Saving is immediate; it is confirmed by the message “Saved: 12 – 16 Oct
  “unavailable”” in the corner of the screen.

Days already filed carry the colour of the mode and a letter (`U`, `P`, `W`).
A dot in the corner of a day is your duty; if “unavailable” lands on a day
with a duty, the day gets an amber outline and a warning appears under the
calendar - the entry does not take the duty away, you have to hand it over by
a swap or ask the coordinator. Past days cannot be selected.

The **Reason** field under the calendar is optional and applies to the next
entries; the reason is shown when you hover over a day.

### What each mode means

- **Unavailable** - a **hard** rule. The generator will not assign you a duty
  in this range. Use it for leave, training, absence.
- **Prefer not** - a **soft** preference. The generator will avoid these days,
  but may assign them if the schedule cannot be staffed otherwise or if it
  would cost too much equal share.
- **Willing** - a soft preference the other way round.

The strength of the soft preferences depends on the “Team preferences” weight
in the generator settings. They are not a promise.

### Privacy of the reason

The reason is seen only by: you, coordinators and administrators. Other team
members only see that the day is taken for you. Viewer accounts do not see
availability at all.

## Filing on behalf of another person

A coordinator and an administrator have a **Person** field in the section
header. Once someone is picked, the calendar shows that person's availability
and saves entries on their behalf:

- the person gets a notification about it,
- they can remove the entry,
- the operation goes to the audit as “Availability filed (on behalf)”.

If your own account is not in the rotation, picking a person is mandatory -
until you do, the section shows the prompt “Pick a person” instead of the
calendar; the other sections of the screen are absent then.

## When to file

Availability affects the schedule only when it exists **before** the draft
covering those days is generated. Filing after publication does not change
the schedule by itself - you then have to use a [swap](zamiany.md).

## My points

One number: your deviation from the fair share of points over the last 12
months (for example `+0.5`), under it a two-way bar and the verdict against
the threshold (**Within limits** or **Outside limits**, with the threshold
given in the text). The table of months shows points, the number of duties
and weekend days; the **12 months** / **This month** switch narrows the list.
The **Full fairness report** link leads to the screen with the whole team -
how points are counted is described in
[Fairness](../produkt/sprawiedliwosc.md).

## Swaps

A summary of the swaps you take part in: who hands over to whom, the day and
role, and underneath, whom the swap is waiting for. A request addressed to you
has a **Decide** button, which opens the “To me” inbox on the Swaps screen;
**All** opens the whole screen.

## Calendar subscription (ICS)

The **ICS export (mine only)** button opens a panel with addresses that show
**only your duties**.

1. Enter a **Subscription name** (for example “phone”) and click
   “Create ICS address”.
2. Copy the address with the copy button - the address is shown only once.
3. Add it in your calendar application as a subscription to an internet
   address.

Duties appear as all-day events. Corrections and approved swaps arrive as
**updates of existing entries**, not as new ones.

An address can be revoked at any time with the **Revoke** button. Once
confirmed, it stops working immediately and cannot be restored - a new one has
to be created. The **Show revoked** switch under the list also shows addresses
already revoked.
