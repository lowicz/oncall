# Swaps

The **Swaps** screen (`/zamiany`) handles replacements for a specific day and
role, also when the base rotation is weekly.

## Inbox

All requests are in one inbox; the filters in the header of the **Inbox**
section say whom a given request is waiting for, and the counter next to each
filter - how many there are:

| Filter | What it contains |
| --- | --- |
| **To me** | requests in which it is you who is to accept or decline the replacement |
| **Sent** | your own requests waiting for the replacement to agree |
| **For approval** (for a team member: **In progress**) | the remaining open requests, including yours once the replacement has agreed and they wait for the coordinator; for a coordinator the counter covers only requests accepted by the replacement and waiting for their approval. When swap approval is switched off (see [Coordinator approval](#coordinator-approval)), a coordinator also sees the ordinary **In progress** here |
| **Closed** | approved, rejected and withdrawn, including those the application closed [after their date](#date-passed) |

The screen opens on the inbox in which something is waiting for you; the
address `/zamiany?skrzynka=moje` opens the named one. The total of requests
that need your action also appears as a badge next to the “Swaps” item in the
navigation.

A table row gives the day and the roles that move, who hands over, who takes
over and the **stage** - who is next. A coordinator who approves swaps also
has the **effect** column (the person who gains points, and how many; “no
change” when nobody does); the icon by its header says what it shows. With
swap approval switched off nobody has this column. An
[exchange](#exchanging-a-duty-for-a-duty) has both days in the first column.
The **“breaks rules”** tag marks a request described in
[A swap that breaks the rules](#a-swap-that-breaks-the-rules). The **Decide**
button (when the decision is yours) or **Preview** opens the request sheet.

On a phone (a screen narrower than 900 px) the inbox is a list instead of a
table: a row gives the day and the roles, who hands the duty to whom (“You”
instead of your name) and whom the request is waiting for; the status sits
beside the day and the button is on the right, within reach of the thumb.

Closed requests load 50 at a time, newest first; the **Show older** button
under the list loads the next ones. While there are older ones, the closed
count in the screen header carries a “+” (for example “50+ closed”).

## Decision sheet

The sheet shows both people, the duty, the requester's reason, the stage bar
(filed → replacement → coordinator → in the schedule; the “coordinator” stage
disappears when swap approval is switched off), the **Effect on the balance**
of both people, the rules the swap breaks and warnings. For an
[exchange](#exchanging-a-duty-for-a-duty) it shows two duties instead of two
people: the one given and the one taken in return. You make the decision in
the same place:

- The **replacement** clicks “Accept” or “Reject”. With approval switched off,
  the sheet announces that acceptance will write the swap into the schedule
  right away, and the confirmation says the same (“Accepted. The swap is
  written into the schedule.”, with a **Show day** button). With approval
  switched on, the confirmation reads “Accepted. Waiting for the coordinator to
  approve.”.
- A **coordinator or administrator** clicks “Approve and write into the
  schedule” or “Reject” - only when swap approval is switched on.
- The **author** can “Withdraw” their own request as long as no decision has
  been made.

**Rejection** requires a reason, but the field appears only after you click
“Reject”: “Confirm rejection” takes its place in the same row of buttons and
stays inactive as long as the reason is empty. Both sides see the reason, it
stays with the request and in the audit. **Withdrawing** your own request needs
no reason; if you give none, “wycofane przez autora” (withdrawn by the author)
stays with the request.

## Filing a request

The **Request a swap…** button in the screen header opens the form in a panel;
the same button on the My duties screen and in the schedule's day panel opens
it with the duty already chosen. The form leads through four steps: duty, replacement, in return
(optional) and sending. Once the replacement is picked the bar moves straight
on to sending, as “Nothing, I only give the duty away” is already chosen.
Once a request has been started, closing the panel, going to another screen, or reloading requires a decision whether to discard the entered data.

1. In the **My duty** field pick your upcoming duty. The list has one item a
   day: the date, every role you hold that day (for example “SECONDARY +
   11–19”) and how far away the day is. A duty colliding with your
   “Unavailable” entry is marked. A day with two roles has the **I give**
   choice under the field (see below).
2. Under the field appears the **Replacement** list: eligible and available
   people who do not hold the opposite role that day, best fit first. A
   person's card gives the name, their availability, one verdict and one
   number - the deviation from the fair share in points (for example
   “-0.5 pts”) - so you compare several people at a glance. The first card
   carries the **“best match”** tag when that person breaks no hard rule and the
   swap evens out their balance the most. Clicking picks the person; under
   their card appear the remaining facts: the rule the request would break,
   with its days, a duty the person already has that day, a split block of
   days off, their share in points and whether the swap improves the balance.
   From the keyboard the list is a single Tab stop: the arrow keys change the
   selection and skip blocked cards, the same as in the **In return I take**
   list. The verdict on the card:
   - **“hard rule”** - the person is blocked by a rule a swap may not break,
     and cannot be picked; the card names that rule in place of the
     availability,
   - **“needs confirmation”** - the person can be picked, but the request
     then needs an acknowledgement (see
     [A swap that breaks the rules](#a-swap-that-breaks-the-rules)); such
     people are listed after those who break no rule,
   - **“warning”** - the swap violates a soft rule, for example it splits a
     block of days off; the coordinator will see it,
   - **“no violations”** - the swap breaks nothing.

   The note **“Will take only SECONDARY, does not work 11–19.”** (with the
   name of your on-call role) under the picked person's card on a whole duty
   says the person cannot work the 11–19 shift: they take the on-call role
   alone and the shift stays with you. This is the exception to the anchor
   and only warns.
3. Optionally pick, in the **In return I take** list, a day of that person
   whose duty you take in exchange (see
   [Exchanging a duty for a duty](#exchanging-a-duty-for-a-duty)). With no
   pick the request only gives your duty away.
4. Under the list you see the folded **Effect on the balance** section (when
   there are warnings: **Effect on the balance and warnings**). Its line sums
   up how many points each of you gains or loses and counts the warnings (for
   example “You -1 · Piotr +1 · 1 warning”); unfolded it shows the balance of
   both people, counted over every slot that moves, and the warnings.
5. Optionally add a **Reason**; the replacement and the coordinator will see
   it. The reason is not required, also when the swap breaks rules.
6. “Send request”. While something is missing, the panel footer says what
   next to the button: the duty, the replacement, the rule confirmation or a
   published schedule; with a hard rule - another person or another duty in
   return. The screen confirms the sending with the message
   “Sent to: …” with an **Undo** button and moves to the **Sent** inbox.
   “Undo” within 10 seconds withdraws the request with the reason “cofnięte
   zaraz po wysłaniu” (undone right after sending). The message to the replacement waits for the end of
   that time, so a request withdrawn in time sends the replacement no message
   at all.

When you hold an on-call role and the 11–19 shift that day, the **I give**
choice appears under the **My duty** field: “Whole duty”, “Only SECONDARY”
(or “Only PRIMARY” - the name of your role that day) and “Only 11–19”. The
hint under it says what moves or what stays with you, and the candidates and
the effect on the balance are computed for that choice. A day with one role
has no such choice.

- When the “11–19 anchor” setting binds the two roles (the anchor role and
  11–19), the **whole duty** is the default: both slots at once, one
  acceptance by the replacement and one approval by the coordinator.
- Giving one role of such a pair splits it. The request then breaks the
  anchor rule and takes the path described in
  [A swap that breaks the rules](#a-swap-that-breaks-the-rules); the hint
  announces this once, not on every candidate. The exception is giving the
  anchor role alone to a person who cannot work the 11–19 shift that day:
  that is the exception to the anchor and only warns, with no confirmation.
  The other role stays with you and can be requested separately.
- When the anchor does not bind the two roles (the “Independent of on-call”
  setting, or an on-call role other than the anchor role), one role moves by
  default and “Whole duty” moves both; the person taking over then needs
  eligibility for both.

When the swap violates a soft rule (for example it splits a block of days
off), you will see the warning “You can still send it - the coordinator will
see the warning” in the **Effect on the balance and warnings** section. Sending is still possible.

## Exchanging a duty for a duty

A duty handed over adds one day to the replacement's week, so in a full
schedule a rest rule is easily broken. An exchange only moves it: you give
your duty and take one of the replacement's duties in return. Each of the two
people then has as many duties as before, so usually no rule is broken.

After you pick the candidate, the form shows the **In return I take** list
with their duties of the next 90 days, one item a day. The first item,
“Nothing, I only give the duty away”, is the ordinary one-way request. Every
item carries a verdict computed for the whole exchange, both directions at
once:

- **“no violations”** - the exchange breaks nothing; when giving the duty
  away alone would need an acknowledgement, the first such item carries the
  **“best match”** tag,
- **“warning”** - the exchange violates a soft rule; sending is possible,
- **“needs confirmation”** - the exchange breaks a rest or anchor rule and
  takes the path described in
  [A swap that breaks the rules](#a-swap-that-breaks-the-rules),
- **“hard rule”** with the rule in place of the roles - this item cannot be
  picked.

When the replacement holds an on-call role and the 11–19 shift that day, the
same choice as **I give** appears under the picked item, here as **I take**:
“Whole duty”, “Only SECONDARY” (or “Only PRIMARY”) and “Only 11–19”. The item
then shows the roles that come back and the verdict for that choice; this is
how you give, for example, your 11–19 shift on Tuesday for the replacement's
11–19 shift on Wednesday. The default is the same as when giving: the whole
duty when the anchor binds the two roles, one role when it does not. If a hard
rule rules the default out and another choice is possible, the item offers
that one: when you hold the other on-call role that day yourself, you get the
11–19 shift alone. A day with one role has no such choice.

The rules of an exchange:

- one day moves in each direction - the whole duty or one role of it - and the
  day taken in return is another than the one given,
- a whole duty taken in return moves like one given: the anchor role and
  11–19 travel together, and when you cannot work the 11–19 shift, the shift
  stays with the replacement (the exception to the anchor, a warning only);
  taking one role of an anchored pair splits it and needs an acknowledgement,
- you need eligibility for every role taken in return and must have no
  “Unavailable” entry that day,
- no other open request may cover the duty taken in return,
- the two duties may belong to different published schedules.

An exchange is indivisible: **one acceptance** by the replacement (and one
approval by the coordinator, when it is switched on) covers both sides, and
both duties move together or not at all. If either of them changed owner
before the decision, the request is cancelled.

In the inbox an exchange has both days in the first column with the roles that
move (for example “Tue 6 Oct 11–19 ⇄ Wed 7 Oct SECONDARY + 11–19”), and the
note “exchange”. The
decision sheet shows the replacement the rows **You get** and **You give**,
the author **You give** and **You get**, and everyone else **Duty** and **In
return** - each with the day, the roles and the other person. When an open
exchange breaks nothing, the sheet says so outright. The e-mails name both
duties, and the reminder to switch the phone number over gives the days an
on-call role moves on; the 11–19 shift alone needs none.

## A swap that breaks the rules

Sometimes the only person who can stand in for you already has too many
duties - for example everyone else is on leave. Such a swap can be requested,
but everyone who moves it forward has to do so knowingly. Before you do, check
the “In return I take” list: an [exchange](#exchanging-a-duty-for-a-duty)
often breaks no rule at all.

Breaking four rest and anchor rules can be acknowledged:

- more than 3 consecutive on-call days,
- more than 3 on-call duties within 7 days,
- less than 2 days of rest after a run of on-call duties,
- the 11–19 shift and the anchor role held by different people, also when the
  request gives or takes in return only one role of the anchored pair.

The other hard rules block a swap without exception: the same person will not
take both on-call duties of one day, and the 11–19 shift will not land on a
day off work. The list gives such a candidate the verdict “hard rule”.

How it goes:

1. The **requester**, after picking the candidate, sees the box “This swap
   breaks the schedule rules” with a list: who, which rule and on which days,
   and a link “Which rules can be confirmed?” to this chapter.
   The “Send request” button works only after ticking “I understand and
   knowingly break these rules”; the **reason** is optional. Picking another
   candidate, or another duty in return, including another **I take** choice,
   takes the tick back.
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
to acknowledge it; if it stopped - no acknowledgement is needed. When the
list changes on the screen you have open, the tick is taken back and has to be
given again.

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
 the application, once the duty day passes with no decision: Withdrawn
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

- creates a correction (override) only on the slots the request covers - for
  an exchange in both directions, in one step,
- **does not recompute** the other days of the schedule,
- raises the version of the published schedule,
- sends out notifications and updates the ICS feeds,
- assigns the points (X / 2X) to the person **actually on duty**,
- sends a reminder to switch the phone number over.

## Date passed

A request concerning a day that has already been gets the note **“date
passed”** in the table and loses its decision and withdrawal buttons; for an
exchange it is enough that the earlier of the two days has passed. Such a
request no longer waits for anybody's decision: it is counted and listed
among the **Closed** ones at once, so it leaves the **To me** inbox, the count
of requests waiting for your decision and the badge next to the “Swaps” item
in the navigation.

The application closes it on its own, usually within the hour: the request
gets the status “Withdrawn” and the reason “Termin dyżuru minął” (the duty
date has passed; recorded text stays Polish). Nobody gets a message about it;
the audit log keeps an entry **Swap closed after its date** whose author is
“system”. For an exchange this frees the later of the two duties, so it can
be asked for again.

A replacement cannot be accepted retroactively - such a day is fixed by the
coordinator with a correction on the matrix.
