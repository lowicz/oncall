# Now and Schedule

Everyday work with the schedule happens on two screens: **Now** (`/`) answers
the question “who is on duty?”, and **Schedule** (`/grafik`) shows the
people × days matrix for a chosen range.

## Now

The title of the screen is today's date, and under it the state of the
published schedule: how far it reaches and the day it was published
(“publication of 28 Aug”). On a day off
or a holiday the subtitle adds that the 2X rate applies (`PRIMARY` and
`SECONDARY` then last around the clock). The subtitle also gives the number
of swaps waiting for your decision (a link to Swaps) and, for a coordinator,
the result of the fairness criterion. Who is on duty at this moment, until
when and on which phone number is shown all the time by the “On duty now”
strip above every screen, so the screen itself does not repeat the staffing.
A role nobody holds is bold in the strip and marked with a red dot:
**unstaffed**.

The actions on the right depend on the role: a team member has **File
availability** (it leads to the My duties screen), a coordinator and an
administrator have **Generate the next range**, which opens the Generator with
a range starting the day after the end of the published schedule.

Under the header is a row of risk badges, about the visible range only: days
without full coverage, days outside the published range and, for a
coordinator, people on duty on a day of a filed “Unavailable”. A badge that
leads to a day ends in an arrow.

Below is the **Next 4 weeks** section with the same matrix as on the Schedule
screen and the same strip of controls in the section header: length 2 / 4 / 8
weeks, a week back and forward, back to today and a **⋯** (**More**) menu with
**On duty only**, **Day list**, **Legend** and, for a team member, **ICS
subscription**. When nobody is in the rotation yet, the section says so plainly
instead of showing an empty matrix, and shows no controls; an administrator
gets an **Open People** button in it to add the team. When the team has
people but none of them is in the rotation in the visible range, the section
also says so plainly, but keeps the controls so you can move to a range with
duties.

On a phone the screen replaces the “On duty now” strip with three cards -
`PRIMARY`, `SECONDARY` and `11–19` - with the name, the coverage window, the
**Call**, **SMS** and **E-mail** buttons (when the contact details are filled
in) and who takes the role next. On a Saturday, Sunday or holiday the `11–19`
card shows that this shift is **not applicable** - it is not a gap in the
staffing. Under the cards a team member sees their next duty, and the schedule
is a list of days.

## Handing over the number

The on-call number rings at the person on `PRIMARY`. When they have to leave
and have agreed it with the person on `SECONDARY`, they can hand the number to
that person for a few hours, without an administrator and without logging in
to the WCO panel. A handover is visible only when an administrator has set
number forwarding to **On** or **Dry run**; with **Off** the application does
not know where the number rings, so it shows neither the badge nor the buttons.

### Where you see whom the number rings at

The **on-call number** badge stands by the person the number rings at: in the
“On duty now” strip, on the phone cards and in the header of the Now screen.
During a handover it is by the person on `SECONDARY` and says until when:
“on-call number · until 13:40”. The `PRIMARY` phone stays in the strip, because
that person is the one answerable for the duty. Clicking the badge shows the
details: who answers, from when until when, whether WCO has confirmed the
forwarding and at what time. The badge changes state as it happens, and the
state is also given in words, not by colour alone:

| State | What it means |
| --- | --- |
| **on-call number** | WCO has confirmed the number rings at this person |
| **switching** | WCO has not confirmed the forwarding yet |
| **not switched** | WCO did not confirm by the alert threshold; the number may still ring at the previous person |

In **Dry run** mode the details say that WCO will not be changed: the handover
is recorded, but the number at the switchboard stays as it was. When the trial
sign-in to WCO fails, the badge says **not switched (trial)** at once, and the
details say that in a dry run nobody gets an e-mail.

### How to hand the number over

The button belongs to the day's duty pair: the person on `PRIMARY` sees **Hand
over the number…**, the person on `SECONDARY` **Take the number…**. A
coordinator and an administrator see it too, on behalf of the pair. Nobody
else has it, because a handover is only within the day's pair; other changes of
staffing are done with a correction.

1. Click the button. On a desktop a popover opens by the button, on a phone a
   sheet from the bottom with a **Close** button; it is not a question window.
2. Choose for how long: **1 h**, **2 h**, until the end of the duty (the button
   gives the time, tomorrow 9:00 by default, the reminder hour) or **other…**,
   which reveals a time field. The sentence under the choice says when the
   number comes back, for instance “The number comes back to you at 13:40”. The
   time has to be later than now and no later than the end of the duty; a
   segment that would exceed it is disabled.
3. Click **Hand over the number** (**Take the number** when taking). One click
   from one side is enough: the agreement is made by phone, and the other side
   does not have to approve anything.

The notification “Switching the number · Marek Nowak answers · until 13:40” has
an **Undo** button for a few seconds, which ends the handover. After that the
badge by the new person says **switching**, and once WCO confirms, **on-call
number**.

When the person taking over has no phone number on the My duties screen, the frame
in the popover says so by name and blocks the button: the number has to be
filled in first. When the number is already handed over, the badge says until
when, and the hand-over button is replaced by the end button described below.

### How the number comes back

- **By itself**, at the chosen time or at the reminder hour at the latest, when
  the number moves to the next person on `PRIMARY` anyway. Nothing has to be
  clicked and nobody asked.
- **By hand**, in the same place where the handover began: the person on
  `PRIMARY` clicks **Take the number back**, the person on `SECONDARY` **Give
  the number back**, and a coordinator **End the handover**. An administrator
  can also use **End the handover** on the State card of the
  [Number forwarding](administracja.md#number-forwarding-przelaczanie-administrator)
  screen. Ending asks no confirmation, because handing over again is one click;
  the notification says who answers the number again.
- **Through a schedule correction**: when a correction or swap changes who is on
  `PRIMARY` or `SECONDARY` that day, swapping the two roles included, the
  handover ends by itself and the number
  returns to whoever the schedule has on `PRIMARY`. Both sides then get the
  e-mail “Przekazanie numeru on-call zakończone przez korektę grafiku”, and the
  correction frame warns beforehand: “This correction ends the on-call number
  handover Anna Kowalska → Marek Nowak.” This is the only e-mail about a
  handover: none goes out on success, because both sides have agreed it and the
  state is in the strip.

### When the switch fails

If WCO does not confirm the forwarding, the badge turns red, **not switched**,
and is announced to a screen reader as an alert; next to the handover buttons
**Check again** appears, and **End the handover** gives the number back to the
person on `PRIMARY`. The “Numer on-call” alert e-mail then goes to the
coordinators and administrators, to the person on `PRIMARY` and to the person
who was to take the number over, so that nobody waits for a phone that does not
ring. The worker keeps trying by itself.

Every handover and its end are in the [Audit](administracja.md#audit-audyt-administrator)
(“Przekazano numer on-call: Anna Kowalska → Marek Nowak do 13:40”,
“Zakończono przekazanie numeru on-call … zakończone ręcznie”), together with
who started it.

## Schedule: the people × days matrix

The screen header gives the range of the published schedule and the day it
was published, and
for a coordinator also the proposal waiting for publication; the **Open the
proposal** button leads straight to it in the Generator. A team member finds
the ICS subscription in the **⋯** menu above the matrix and on the My duties screen.

The default range starts today and covers four weeks (or fewer, if the published schedule ends earlier).
If the publication has expired, the screen shows four weeks from today and a warning with the end date, and a coordinator also gets the way to the Generator (or to the waiting proposal).
An invalid range from the address shows a **Show from today** action instead of leaving the screen without controls.
The section header above the matrix names the range, its length and the number of people in the rotation, and when the range has days without full coverage, also their number with a link to the first of them (“2 days without full coverage, first on 14-11”). People are on
the vertical axis, consecutive days on the horizontal one. The people column
and the date headers stay visible while scrolling.

The header of each column gives the day of the month, the weekday
abbreviation and the marks for a weekend, a Polish holiday and the **2X**
rate. Calendar events are marked with a bar in the event's colour.

Next to a person's name is a load bar for the range and the **You** mark on
your row, or **out of the rotation** when the person has no eligibility for
any role in this range.

A cell combines two pieces of information:

| What | How it looks |
| --- | --- |
| duty | `P` (`PRIMARY`), `S` (`SECONDARY`), `11–19` |
| availability | “Unavailable”, “Prefer not”, “Willing” |
| correction or swap | a separate status, not just a different colour |

Colour is never the only carrier of information - every state also has a text
label, read by a screen reader as well. The **Legend** item in the **⋯** menu
above the matrix expands the list of symbols; `Esc` closes it.

### Risks in the range

On the Now screen, above the matrix, is a row of badges: days of the published
schedule without full coverage (clicking jumps to the first such day), days
outside the published range, people on duty on a day of a filed
“Unavailable” (clicking jumps to the first such day), or **Full coverage**
when everything is fine.
Narrowing the view cannot hide an active conflict without this message. The
Schedule shows the same matrix without the risk row; days without coverage
are marked in red in the column header and in the day panel there, and the
section header gives their number with a link to the first.

### Day details

Clicking a cell (or `Enter` on the selected cell) opens the day panel: the
staffing of each role, calendar events and filed availability. You move around
the grid with the arrow keys, `Home` and `End` jump to the beginning and end
of the row, and `PageUp` and `PageDown` jump a week.

From this panel:

- a **team member** can start a swap request for their own slot,
- a **coordinator and an administrator** can change any assignment directly,
  without the replacement's consent and without an acceptance step. Every
  role row in the panel ends in a **Change…** button (an empty role:
  **Assign…**), and clicking anywhere on the row does the same. Under the
  rows, which stay in place with the changed roles lit, a “Staffing change”
  frame opens with everything there is to know about the change, without a
  separate confirmation dialog. The **Roles to change** group has PRIMARY,
  SECONDARY and 11–19 boxes (the last on working days only); the clicked
  role is ticked, and one correction can give one person two roles, for
  example SECONDARY and 11–19. PRIMARY and SECONDARY exclude each other,
  because one person cannot hold both on-calls that day: while one is
  ticked, the other is unavailable, with the reason under the group. 11–19
  is ticked by default exactly when the policy binds it to the ticked role
  and the person in that role holds 11–19 too; a sentence under the group
  says why 11–19 is ticked or not. The 11–19 row in the panel carries a
  “coupled with SECONDARY” (or “coupled with PRIMARY”) tag when the person
  in the anchor role holds it, and “outside the coupling with SECONDARY”
  when someone else does; under an “independent” coupling there is no tag.
  Unticking 11–19 leaves it unchanged, and if that parts it from its anchor
  role, the frame shows the coupling rule for knowing confirmation. The
  **Person for `<roles>`** field lists everyone in the rotation that day,
  and with two roles it says after the name which of them the person can
  take (“Marek Nowak · SECONDARY, 11–19”). Whoever cannot be picked stays on
  the list with the reason after the name (“Anna Kowalska · unavailable that
  day”). A person who can take only part of the ticked roles (“Piotr
  Zieliński · only SECONDARY (no 11–19)”) stays on the list too, but
  choosing them does not change what is ticked: the field says what to
  untick or whom to choose instead, and the save waits. The hint under the
  field describes the chosen person: the roles they may hold that day and
  what they reported for it. Under the choice are a row-by-row preview (who
  gives up which role), the rule line checked on the state after every
  change (“No hard rule is broken”) and the effect on the points balance of
  everyone the change touches. If the change breaks a hard rule, the rule
  line gives way to a “This correction will break hard rules” frame with
  the list of violations and an “I understand and knowingly break these
  rules” box; such a violation goes to the audit log. A correction of a day
  that has already passed asks for a reason (at least 10 characters, an
  audit requirement) in a field of the same frame. **Save the staffing
  change** (with two roles **Change staffing (2 roles)**) saves only once a
  person is chosen, the rules are checked, the violations are acknowledged
  and the reason is given. Two roles are one schedule change with one
  “Schedule correction” audit entry and one “Zmiana przydziału” message for
  each person, listing only their own slots. When the save is refused, for
  example because the schedule changed in the meantime, the reason for the
  refusal appears in the frame and takes the focus, and a refusal that
  names newly broken rules shows them right away for acknowledgement. After
  the save the panel closes and a notification says what changed (“Staffing
  changed 11 Mar: Marek Nowak SECONDARY and 11–19”). When every changed role
  can go back to the person who had it, the notification has an **Undo**
  button that restores the previous staffing in one change; the e-mails go
  out only once the “Undo” window closes, and after an undo they do not go
  out at all. When it cannot be undone (the role was empty, or the previous
  person cannot take it back that day), the notification says who gets an
  e-mail, and its **Show day** button opens that day's panel again,
- a **coordinator and an administrator** can swap the people on PRIMARY and
  SECONDARY of that day in one move, without corrections through a third
  person. The **Swap places…** button sits between the PRIMARY and SECONDARY
  rows when the two roles have different people, and opens a “Swapping
  places” frame in the panel: a row-by-row preview (who moves to which role),
  the rule line checked on the state after the swap and the effect on both
  people's points balance. When one of them is not eligible for the other's
  role that day or is marked unavailable on it, the button is inactive and a
  sentence under it says why. If the policy binds 11–19 to the role
  given up by the person who also holds 11–19, the frame has a “together with SECONDARY”
  (or “together with PRIMARY”) box, ticked exactly when the other person is
  eligible for 11–19, with one sentence saying why. Unticking it leaves
  11–19 unchanged and shows the coupling rule for a knowing
  acknowledgement. A reason is needed only for a day that has already passed
  (a field in the frame, at least 10 characters). **Swap places** saves the
  swap as one schedule change with one audit entry (“Swapped the day's roles”);
  both people get a “Zamiana ról” e-mail once the “Undo” window closes. The
  message after the save has an **Undo** button, and for the same time the
  panel shows **Undo the swap** in place of “Swap places…”; undoing restores
  the previous staffing and the e-mails do not go out,
- a **coordinator and an administrator** can open a separate window with
  **Event…** and add a calendar event on that day there; the day panel waits
  underneath and shows the new event once it is saved. An event is deleted
  from the day panel; deleting works at once, and the notification has an
  **Undo** button that brings the event back for a few seconds.

When someone holds a duty on a day they reported “Unavailable” for, a
coordinator sees a frame above the day's staffing, “Conflict: Jan Wiśniewski
holds PRIMARY on 14 Mar despite reporting “Unavailable””, with the reason given
and a **Change person…** button that opens the staffing change of that
role. A screen reader reads the same text with the role row.

Reasons for unavailability stay private: a coordinator sees them in the
details, a team member only on their own entries, and a viewer account gets
no availability data at all.

## View controls

The controls are one strip in the section header above the matrix, the same
on Now and on the Schedule:

| Control | What it does |
| --- | --- |
| **2 wk** / **4 wk** / **8 wk** | sets the length of the range; a longer range has smaller cells |
| **‹** / **›** | moves the whole range by seven days |
| **today** | returns to the range starting today |
| **⋯** → **On duty only** | hides people without an assignment in the range |
| **⋯** → **Day list** | switches between the matrix and the list of days |
| **⋯** → **Legend** | expands the list of symbols |
| **⋯** → **ICS subscription** | opens the calendar addresses with your duties on the My duties screen (team member) |

On Now and on the Schedule the start of the range, its length, the **On
duty only** filter and the choice between the matrix and the day list are part
of the page address (`/grafik?od=2026-09-14&zoom=8&tylko=z-dyzurem&widok=lista`,
on Now `/?od=2026-09-14&zoom=8`; without `widok` a narrow screen starts with the
day list and a wide one with the matrix), so refreshing the page keeps the view and a link to it can be passed on;
older links with `od` and `do` still work. The command palette
opens the schedule with a person highlighted or with the panel of the given
day; the highlighted person's row carries the tag “highlighted” next to the
name, and the highlight is switched off by the badge next to the header.

If the first schedule fetch fails, the “On duty now” strip shows **no data** and **no connection**, not **unstaffed**.
Fetch errors give the next step: check the connection and try again.

## Small screens

The **Day list** view turns the matrix into a list: one row per day, with the
staffing of all roles. It is the same complete set of information, laid out
vertically; tapping a role opens the details. On a phone the day panel opens
as an overlay above the list.

## Read-only view

A viewer account and a session from a preview link see the matrix in
read-only mode, without availability data and without actions. The “On duty
now” strip and the cards on a phone show them the phone number of the person
on duty (with **Call** and **SMS**), but not the e-mail address. A session
from a link additionally shows a banner with the name of the link, its date
range and its expiry date.

In a session from a link, the matrix section on the Now screen shows only the
days of the link's range. A link covering at most 8 weeks is visible in full,
with the header “link range” and without the length switch and the arrows. In
a longer link the arrows move the view only within its bounds.
