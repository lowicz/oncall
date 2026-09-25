# Now and Schedule

Everyday work with the schedule happens on two screens: **Now** (`/`) answers
the question “who is on duty?”, and **Schedule** (`/grafik`) shows the
people × days matrix for a chosen range.

## Now

The title of the screen is today's date, and under it the state of the
published schedule: how far it reaches and which version it is. On a day off
or a holiday the subtitle adds that the 2X rate applies (`PRIMARY` and
`SECONDARY` then last around the clock). Who is on duty at this moment, until
when and on which phone number is shown all the time by the “On duty now”
strip above every screen, so the screen itself does not repeat the staffing.

The actions on the right depend on the role: a team member has **Export ICS**
and **File availability** (both lead to the Mine screen), a coordinator and an
administrator have **Generate the next range**, which opens the Generator with
a range starting the day after the end of the published schedule.

Under the header is a row of risk badges: days without full coverage and days
outside the published range (as on the Schedule), the number of swaps waiting
for your decision (leads to Swaps) and, for a coordinator, the result of the
fairness criterion (leads to the report).

Below is the **Next 4 weeks** section with the same matrix as on the Schedule
screen and the same controls in the section header: length 2 / 4 / 8 weeks, a
week back and forward, back to today, **On duty only**, **Legend** and **Day
list**. When nobody is in the rotation yet, the section says so plainly
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

## Schedule: the people × days matrix

The screen header gives the range and version of the published schedule, and
for a coordinator also the proposal waiting for publication; the **Open the
proposal** button leads straight to it in the Generator. A team member has
**Export ICS** here.

The default range starts today and covers four weeks (or fewer, if the
published schedule ends earlier). The section header above the matrix names
the range, its length and the number of people in the rotation. People are on
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
label, read by a screen reader as well. The **Legend** link in the section
header expands the list of symbols; `Esc` closes it.

### Risks in the range

On the Now screen, above the matrix, is a row of badges: days of the published
schedule without full coverage (clicking jumps to the first such day), days
outside the published range, duties colliding with a filed “Unavailable”, or
**Full coverage** when everything is fine. Narrowing the view cannot hide an
active conflict without this message. The Schedule shows the same matrix
without the risk row; days without coverage are marked in red in the column
header and in the day panel there.

### Day details

Clicking a cell (or `Enter` on the selected cell) opens the day panel: the
staffing of each role, calendar events and filed availability. You move around
the grid with the arrow keys, `Home` and `End` jump to the beginning and end
of the row, and `PageUp` and `PageDown` jump a week.

From this panel:

- a **team member** can start a swap request for their own slot,
- a **coordinator and an administrator** can change any assignment directly,
  without the replacement's consent and without an acceptance step. The change
  shows the effect on both people's points balance, saves a correction and
  concerns only the chosen day and role. A correction of a day that has
  already passed requires giving a reason. If the change breaks a hard rule,
  the confirmation lists the violations under the heading “This correction
  will break hard rules”, and the save button works only once you tick that
  you are breaking them knowingly; such a violation goes to the audit log,
- a **coordinator and an administrator** can add a calendar event on that day
  from the same panel.

Reasons for unavailability stay private: a coordinator sees them in the
details, a team member only on their own entries, and a viewer account gets
no availability data at all.

## View controls

The controls are in the section header above the matrix, the same on Now and
on the Schedule:

| Control | What it does |
| --- | --- |
| **2 wk** / **4 wk** / **8 wk** | sets the length of the range; a longer range has smaller cells |
| **‹** / **›** | moves the whole range by seven days |
| **today** | returns to the range starting today |
| **On duty only** | hides people without an assignment in the range |
| **Legend** | expands the list of symbols |
| **Day list** | switches between the matrix and the list of days |

On the Schedule the start of the range and its length are part of the page
address (`/grafik?od=2026-09-14&zoom=8`), so a link to a specific view can be
passed on; older links with `od` and `do` still work. The command palette
opens the schedule with a person highlighted or with the panel of the given
day; the highlight of a person is switched off by the badge next to the
header.

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
