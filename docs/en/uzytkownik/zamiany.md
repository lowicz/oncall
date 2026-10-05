# Swaps

The **Swaps** screen (`/zamiany`) handles replacements for a specific day and
role, also when the base rotation is weekly.

## Inbox

All requests are in one table; the filters in the header of the **Inbox**
section say whom a given request is waiting for, and the counter next to each
filter - how many there are:

| Filter | What it contains |
| --- | --- |
| **To me** | requests in which it is you who is to accept or decline the replacement |
| **Mine** | your own, still open requests |
| **For approval** (for a team member: **In progress**) | the remaining open requests; for a coordinator the counter covers only requests accepted by the replacement and waiting for their approval. When swap approval is switched off (see [Coordinator approval](#coordinator-approval)), a coordinator also sees the ordinary **In progress** here |
| **Closed** | approved, rejected and withdrawn |

The screen opens on the inbox in which something is waiting for you; the
address `/zamiany?skrzynka=moje` opens the named one. The total of requests
that need your action also appears as a badge next to the “Swaps” item in the
navigation.

A table row gives the day and role, who hands over, who takes over, the
**effect** (the person who gains points, and how many) and the **stage** - who
is next. The **“breaks rules”** tag marks a request described in
[A swap that breaks the rules](#a-swap-that-breaks-the-rules). The **Decide**
button (when the decision is yours) or **Preview** opens the request sheet.

## Decision sheet

The sheet shows both people, the duty, the requester's reason, the stage bar
(filed → replacement → coordinator → in the schedule; the “coordinator” stage
disappears when swap approval is switched off), the **Effect on the balance**
of both people, the rules the swap breaks and warnings. You make the decision
in the same place:

- The **replacement** clicks “Accept” or “Reject”. With approval switched off,
  the sheet announces that acceptance will write the swap into the schedule
  right away.
- A **coordinator or administrator** clicks “Approve and write into the
  schedule” or “Reject” - only when swap approval is switched on.
- The **author** can “Withdraw” their own request as long as no decision has
  been made.

Rejection and withdrawal require **giving a reason** in a field visible right
away in the sheet; both sides see the reason, it stays with the request and
in the audit. The “Reject” button is inactive as long as the reason is empty.

## Filing a request

The **New swap** button in the screen header opens the form in a panel; the
**Request a swap** button on the Mine screen opens it with the duty already
chosen. The form leads through three steps: duty, candidate, reason and
sending.

1. In the **My duty** field pick your upcoming duty. The list gives the date,
   the role and how far away the day is. A duty colliding with your
   “Unavailable” entry is marked.
2. Under the field appears the **Candidates** list: eligible and available
   people who do not hold the opposite role that day, ordered from the best
   candidate. Next to each you see their availability, their deviation from
   the fair share and whether they already have a duty that day - so you can
   compare two candidates without opening each one separately. Clicking picks
   the person.
   - a person marked **“not possible: …”** is blocked by a rule a swap may
     not break, and cannot be picked,
   - a person marked **“breaks a rule: …”** and **“needs confirmation”** can
     be picked, but the request then needs an acknowledgement and a reason
     (see [A swap that breaks the rules](#a-swap-that-breaks-the-rules)); such
     people are listed after those who break no rule,
   - the **“improves the balance”** mark says the swap will reduce the
     inequality,
   - the **“splits a block of days off”** mark announces a warning for the
     coordinator.
3. Under the list you see the **Effect on the balance**: how many points move
   between the two of you.
4. Optionally add a **Reason**; the replacement and the coordinator will see
   it. The reason is required when the swap breaks rules.
5. “Send request”. The screen confirms the sending with the message “Sent
   to: …” and moves to the **Mine** inbox.

If the “11–19 anchor” setting makes both roles belong to one person that day,
the request will cover **both slots at once** - the screen announces this. One
acceptance by the replacement and one approval by the coordinator settle the
whole thing.

When the swap violates a soft rule (for example it splits a block of days
off), you will see the warning “You can still send it - the coordinator will
see the warning”. Sending is still possible.

## A swap that breaks the rules

Sometimes the only person who can stand in for you already has too many
duties - for example everyone else is on leave. Such a swap can be requested,
but everyone who moves it forward has to do so knowingly.

Breaking four rest and anchor rules can be acknowledged:

- more than 3 consecutive on-call days,
- more than 3 on-call duties within 7 days,
- less than 2 days of rest after a run of on-call duties,
- the 11–19 shift and the anchor role held by different people.

The other hard rules block a swap without exception: the same person will not
take both on-call duties of one day, and the 11–19 shift will not land on a
day off work. The list marks such a candidate “not possible: …”.

How it goes:

1. The **requester**, after picking the candidate, sees the box “This swap
   breaks the schedule rules” with a list: who, which rule and on which days.
   The “Send request” button works only after ticking “I understand and
   knowingly break these rules” and writing a **reason** (at least 10
   characters). Picking another candidate takes the tick back.
2. The **replacement** sees the same list in the decision sheet - next to
   their own name with the note “(you)”, because it is most often their rest
   the swap cuts into. “Accept” works only after ticking the acknowledgement.
3. The **coordinator** - when swap approval is switched on - acknowledges the
   violation the same way before clicking “Approve and write into the
   schedule”. With approval switched off, the replacement's acceptance writes
   the swap into the schedule, and the coordinators get an informational
   message that names the broken rules.

The rules are checked anew at every step, against the schedule as it is at
that moment: the list in the sheet of an open request shows the current state,
not the one from the day the request was filed. If the schedule has changed so
that the swap started breaking a rule, the next person sees the list and has
to acknowledge it; if it stopped - no acknowledgement is needed.

The broken rules are named in the e-mails about the swap and in the audit log
entries (“deliberate rule violation” with the rule identifiers), and a request
already written into the schedule shows them in its sheet under the heading
“Rules broken knowingly”.

## Decision path

```
request ──► Awaiting replacement ──► Awaiting coordinator ──► Approved
                 │                        │
                 └── Rejected             └── Rejected
 author at any time: Withdrawn
```

## Coordinator approval

Whether a swap, after the replacement's acceptance, still waits for the
coordinator is decided by the **A duty swap requires the coordinator’s
approval** setting in the
[Generator settings](generowanie-grafiku.md#generator-settings) panel. It is
shared by the whole team and **on** by default - then everything works as
described above.

Once it is **switched off**:

- the replacement's acceptance alone settles the swap: “Accept” writes it into
  the schedule right away, with the same hard-rule checks that approval
  performs (if the slot has changed owner in the meantime, the request is
  cancelled); a swap that breaks the rules is acknowledged by the replacement
  alone, and the message to the coordinators names the violation,
- the “Awaiting coordinator” status does not occur, and the coordinator has
  nothing to approve or reject,
- **coordinators get the message “For your information: swap written into the
  schedule”** - purely informational, with no request for a decision; both
  sides of the swap receive “Swap written into the schedule”,
- a request that was already waiting for the coordinator at the moment of
  switching off can still be approved or rejected by them.

```
request ──► Awaiting replacement ──► Approved (in the schedule right away)
                 │
                 └── Rejected
 author at any time: Withdrawn
```

## What approval does

The coordinator's approval - or, with approval switched off, the replacement's
acceptance:

- creates a correction (override) only on the chosen day and the chosen role,
- **does not recompute** the other days of the schedule,
- raises the version of the published schedule,
- sends out notifications and updates the ICS feeds,
- assigns the points (X / 2X) to the person **actually on duty**,
- sends a reminder to switch the phone number over.

## Date passed

A request concerning a day that has already been gets the note **“date
passed”** in the table and loses its decision buttons. A replacement cannot be
accepted retroactively - such a day is fixed by the coordinator with a
correction on the matrix.
