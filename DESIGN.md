---
name: On-call
description: An on-call control room - dark, dense, with one action blue and three role colours.
colors:
  night-navy: "#061228"
  control-navy: "#0B1F42"
  control-navy-2: "#122A52"
  control-navy-3: "#1B3765"
  line: "rgba(163, 181, 201, 0.16)"
  line-strong: "rgba(163, 181, 201, 0.34)"
  ink: "#F4F6FA"
  ink-muted: "#A3B5C9"
  ink-dim: "#93ABC1"
  action-blue: "#2870ED"
  action-ink: "#FFFFFF"
  signal-blue: "#65B8FF"
  signal-soft: "rgba(101, 184, 255, 0.16)"
  danger-red: "#BC3B51"
  primary-teal: "#65CDCF"
  secondary-violet: "#B17EAD"
  secondary-text: "#D5A8D2"
  late-salmon: "#FFB196"
  late-text: "#FFB196"
  role-ink: "#0B1F42"
  ok-green: "#6CD99D"
  ok-soft: "rgba(108, 217, 157, 0.14)"
  warn-salmon: "#FFB196"
  warn-soft: "rgba(255, 177, 150, 0.14)"
  warn-text: "#FFB196"
  bad-pink: "#EB4C79"
  bad-text: "#FF8AAA"
  bad-soft: "rgba(235, 76, 121, 0.16)"
  today-wash: "rgba(101, 184, 255, 0.12)"
  weekend-wash: "rgba(163, 181, 201, 0.10)"
typography:
  display:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "32px"
    fontWeight: 700
    lineHeight: "36px"
  headline:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 700
    lineHeight: "28px"
  title:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 700
    lineHeight: "24px"
  section:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: "24px"
  body:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: "21px"
  label:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: "16px"
  mono:
    fontFamily: "Geist Mono Variable, Geist Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: "16px"
rounded:
  marker: "3px"
  xs: "4px"
  sm: "6px"
  md: "8px"
  control: "10px"
  lg: "12px"
  sheet: "16px"
  pill: "999px"
spacing:
  xxs: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "48px"
components:
  button-default:
    backgroundColor: "{colors.control-navy}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "8px 18px"
    height: "40px"
  button-primary:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.action-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "8px 18px"
    height: "40px"
  button-danger:
    backgroundColor: "{colors.danger-red}"
    textColor: "{colors.action-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "8px 18px"
    height: "40px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ink-muted}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "8px 18px"
    height: "40px"
  button-small:
    rounded: "{rounded.pill}"
    typography: "{typography.label}"
    padding: "5px 14px"
    height: "32px"
  input:
    backgroundColor: "{colors.control-navy}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "40px"
  chip:
    backgroundColor: "{colors.control-navy}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "5px 12px"
  status-badge:
    backgroundColor: "{colors.control-navy-3}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "1px 9px 1px 8px"
  role-mark:
    backgroundColor: "{colors.primary-teal}"
    textColor: "{colors.role-ink}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "2px 0"
    width: "32px"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
  nav-link-active:
    backgroundColor: "{colors.action-ink}"
    textColor: "{colors.control-navy}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: "8px 14px"
  panel:
    backgroundColor: "{colors.control-navy}"
    rounded: "{rounded.lg}"
    padding: "12px 14px"
  dialog:
    backgroundColor: "{colors.control-navy}"
    rounded: "{rounded.lg}"
    padding: "16px"
    width: "540px"
  side-panel:
    backgroundColor: "{colors.control-navy}"
    padding: "16px 20px"
    width: "360px"
  toast:
    backgroundColor: "{colors.control-navy-3}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "9px 12px"
    width: "380px"
  now-strip:
    backgroundColor: "{colors.action-blue}"
    textColor: "{colors.action-ink}"
    padding: "10px 16px"
---

# Design System: On-call

A record of the existing visual system, read from `frontend/src/tokens.css`
and `frontend/src/styles.css` (Impeccable scan mode, without an interview
with the owner). The values in the YAML header are normative and match the
default dark theme; the light theme swaps the same variable names
(described under Colors). The descriptive colour names and the "North Star"
are the reviewer's proposal, based on the comments in the stylesheets.

## Overview

**Creative North Star: "Sterownia" (Control Room)**

The stylesheet calls itself the "Control Room stylesheet" (`styles.css:2`),
and the metaphor fits: a dark, matte navy background, one signal strip at
the top saying who is on duty now, and a dense matrix of days as the main
instrument. The interface has to be read in a second by a person who has
just taken a call about an outage, and operated with focus by a
coordinator who is laying out a month. Nothing is decoration: colour
appears only where it carries meaning (role, state, action, today).

The density is deliberate: 14 px body text, 12 px labels, a 35 px matrix
cell (29 px in compact density), panels with 12-14 px inner spacing. Pill
buttons and navigation (999 px radius) are the only soft element against
rectangular panels (12 px) and fields (8 px); they soften the console
without changing its character. Light is a variant, not a second system:
the light theme keeps the same names, the same action blue and the same
role fills, and changes only the surfaces and the ink.

**Key Characteristics:**
- dark navy by default, white as a variant with the same tokens;
- one action blue (`#2870ED`) on the "Teraz" (Now) strip, the primary
  button and the active icon; a second, lighter signal blue (`#65B8FF`) on
  links, selections and focus;
- three fixed role colours: teal `PRIMARY`, violet `SECONDARY`, salmon
  `11–19`, identical in both themes, always with navy ink;
- pills on everything that is clicked (buttons, navigation, chips, badges),
  rectangles on everything that is read (panels, fields, dialogs, cells);
- Inter for text, Geist Mono for dates, times, numbers and figures in
  tables;
- no shadows in the dark theme except for overlays above the content; depth
  comes from three steps of navy (`s1`, `s2`, `s3`) and thin lines.

## Colors

The palette is five steps of navy, two blues with different jobs, three
role colours and four state colours; each has a light-theme counterpart
under the same variable name.

### Primary
- **Action blue** (`#2870ED`, `--act`): the background of the "Teraz"
  strip, the primary button, the selected segment of a segmented control,
  the icon of the active navigation item, the "today" pill in the matrix
  header. Unchanged in the light theme: the strip and the rail are
  navy-and-blue in both themes.
- **Signal blue** (`#65B8FF`, `--sig`; `#064EA1` in light): links, the
  underline of the selected tab, the focus border, the cell selection, the
  selected row, the "box-sig" frame, the Undo countdown bar. Kept apart from
  the action blue so that text and fill each keep their contrast on their
  own background.

### Secondary (roles)
- **PRIMARY teal** (`#65CDCF`, `--p-fill`), **SECONDARY violet**
  (`#B17EAD`, `--sec-fill`), **11–19 salmon** (`#FFB196`, `--late-fill`):
  fills of the role marks in the matrix, of the chips on the "Teraz" strip
  and of the duty cards; always with the **navy role ink** (`#0B1F42`,
  `--role-ink`). As a text colour outside a chip, a role takes its variant
  for the given background (`--p`, `--sec`, `--late`; in the light theme the
  darker `#036A6D`, `#721C7A`, `#B84800`), and 11–19 text on a surface
  (the 11–19 tag, weekend dates) uses `--late-text` (`#A33F00` in light,
  readable on `s3`). On the blue "Teraz" strip a chip is white and its
  letter takes the dark role colour (`--band-p`, `--band-sec`,
  `--band-late`).

### Tertiary (state)
- **OK green** (`#6CD99D` / background `rgba(108,217,157,.14)`): the
  "Opublikowany" (published) status, a criterion met, "Chętnie wezmę"
  (happy to take it).
- **Warning salmon** (`#FFB196`, dot `#FF6130`): a warning status, a share
  exceeded, an availability conflict; the same colour as the `11–19` role,
  told apart by context.
- **Error pink** (`#EB4C79` / background `rgba(235,76,121,.16)`): errors,
  gaps in staffing, "Nie mogę" (I can't), the name of a person in conflict.
- **Danger red** (`#BC3B51`, `--danger`): only the fill of a destructive
  button.

### Neutral
- **Night navy** (`#061228`, `--bg`): the page background.
- **Control navy** (`#0B1F42`, `--s1`): panels, fields, dialogs, the
  navigation rail, the role ink.
- **Second and third navy** (`#122A52` `--s2`, `#1B3765` `--s3`): matrix
  header background, hover, badges, toasts, meter track.
- **Lines** (`rgba(163,181,201,.16)` and `.34`): borders of panels, cells,
  buttons.
- **Ink** (`#F4F6FA`), **muted** (`#A3B5C9`), **dim** (`#93ABC1`): main
  text, secondary text, captions and placeholders.
- **Text variants of states**: error (`#FF8AAA`, `--bad-text`) and
  SECONDARY (`#D5A8D2`, `--sec-text`) are lighter than the stroke and fill
  colours, to keep a contrast of at least 4.5:1 on `s1`, `s2`, `s3` and the
  day washes. Warning (`#FFB196`, `--warn-text`) colours the title of a
  `.box-warn` frame; in the light theme it is darker than `--warn`
  (`#A33F00` instead of `#B84800`). The 11–19 salmon belongs to the role
  alone: the day-off mark (2X) is neutral, the "łamie reguły" (breaks rules)
  tag has the error tone, and "oczekuje" (pending) has one proposal tone on
  every screen.
- **Day washes**: today (`rgba(101,184,255,.12)`), weekend
  (`rgba(163,181,201,.10)`).
- Light theme: background `#F4F6FA`, panels `#FFFFFF`, ink `#303030`,
  headings in navy `#0B1F42` (`--hd`), lines `#E4EAF0`/`#A3B5C9`, muted text
  `#4B6592` and dim text `#4E6A88` (both at least 4.5:1 on `s3` and on the
  weekend wash).

### Named Rules
**The One Action Blue Rule.** On a screen, `--act` appears on the "Teraz"
strip, on one primary button and on the selected segment; never on text
and never as a section background.
**The Fixed Roles Rule.** Role fills do not change between themes or
screens; a role is recognised by its colour before anyone reads the letter.
**The Zero Hex in Components Rule.** Colours exist only in `tokens.css`;
`styles.css` and the components name variables only (`styles.css:7-8`,
`AGENTS.md`).

## Typography

**Display Font:** Inter Variable (with Inter, system-ui)
**Body Font:** Inter Variable
**Label/Mono Font:** Geist Mono Variable (with ui-monospace)

**Character:** one neutral family in three weights (400, 600, 700) and one
monospace face for everything that is a date, a time, a phone number, a
keyboard shortcut or a figure in a column. No italics, no letter-spaced
capitals; capitals only in the role names `PRIMARY` and `SECONDARY`, which
are product vocabulary, not style.

### Hierarchy
- **Display** (700, 32/36 px): the screen title `.ph-title`, the sign-in
  title, the "big number" of the spread in the fairness panel; 24/28 px on a
  phone.
- **Headline** (700, 24/28 px): the name on a duty card `.dcard-name`.
- **Title** (700, 20/24 px): the main section heading `.sech-title`, the
  title of a dialog and of a side panel.
- **Section** (600, 16/24 px): a section heading inside a panel, and the
  month.
- **Body** (400, 14/21 px): body text, fields, buttons (600), list rows,
  table cells.
- **Label** (600, 12/16 px): field labels, table headers, chips, badges,
  steps, rail sections, all captions; the toast title.
- **Mono** (400, 12/16 px; 14/21 px in numeric columns): dates and ranges
  under names, phone numbers, section meta, `kbd` shortcuts.

### Named Rules
**The Text Scale Rule.** Content is 14 px, everything secondary 12 px, a
section or month heading 16 px, and titles 20, 24 or 32 px. A new element
picks one of these steps and nothing goes below 12 px.
**The Mono for Data Rule.** Whatever is a date, a number or an identifier
is set in Geist Mono, so that columns align and the eye tells data from
description.

## Layout

The shell grid: a 232 px navigation rail (`--rail-w`) stuck to the left,
content `minmax(0, 1fr)`; at 901-1100 px the rail collapses to 56 px (icons
only), below 900 px it gives way to five bottom tabs (`.tabs-bottom`) and
the blue top bar `.mob-top`. The "Teraz" strip (`.now`) runs above the
content across the full width and wraps its tools underneath in a
container narrower than 1100 px.

Page: 24 px gutter (16 px on a phone), sections in a grid with a 20 px gap
(12 px on a phone), running text limited to 860 px (`.page-narrow`). The
two-column `.split` gives the content `1fr` and the side panel
320/340/380 px, one column on a phone. The spacing rhythm: 2, 4, 6, 8, 10,
12, 14, 16, 18, 20, 24, 48 px, with a clear majority of 8-14 px inside
components. A panel footer (`.panel-foot`) puts the reason a submit is
blocked (`.foot-status`) and an unsaved-changes note (`.panel-foot-note`)
on a full row of their own above the buttons, never squeezed beside them.

Overlays: a modal dialog of 540 px (small 420, large 760), centred; a side
panel of 360 px (wide 420) from the right, non-modal on a desktop; on a
phone both become bottom sheets with a 16 px top radius and a 36×4 px
handle. Toasts are 380 px in the bottom right corner, on a phone just above
the bottom tabs. The command palette is 560 px, 12 vh from the top. On a
phone the screen's one main action may sit in the thumb zone
(`.thumb-action`: fixed at the bottom right above the tabs, with
`--shadow-sm`, the page padded so it covers nothing).

Matrix: a table with a sticky 170 px name column and a sticky two-row
header (months 24 px, days 40 px); square cells of 35 px (29 px compact),
wider for shorter ranges (48 px up to 14 days); a person's row 48 px;
scrolling within 70 vh. The matrix frame (`.mx`) is as wide as its days,
up to the container, so a short range does not leave half the panel empty.

## Elevation & Depth

The system is essentially flat. In the dark theme depth comes from three
steps of navy (background -> `s1` panel -> `s2` header/hover -> `s3`
badge/toast) and lines at 16 % and 34 % opacity; a shadow appears only
under elements that really lie above the content: the modal dialog and the
palette (`--shadow`: `0 30px 60px -30px rgba(2,8,24,.8)`), the menu,
popover, tooltip, toast and the phone's thumb-zone action (`--shadow-sm`:
`0 10px 30px -12px rgba(2,8,24,.7)`), the side panel (its own shadow to the
left). In the light theme white panels lose their border and get one
shared, subtle shadow (`0 2px 8px rgba(33,65,108,.08)`).

### Shadow Vocabulary
- **Above the content** (`--shadow`): the modal dialog, the command palette.
- **Beside the content** (`--shadow-sm`): menu, popover, tooltip, toast,
  `.thumb-action`, white panels in the light theme.
- **Side panel** (`-30px 0 50px -40px rgba(0,0,0,.7)`): the only shadow
  cast sideways.

### Named Rules
**The Flat at Rest Rule.** A panel in the dark theme has no shadow; it has
a line. A shadow means "this lies above the page and will go away".
**The Inner Frame Rule.** Selection and focus in the matrix and the
calendar are `box-shadow: inset 0 0 0 2px`, not an outer glow, so that the
grid does not jitter.

## Shapes

Two languages of form: the pill (999 px) for everything interactive and
everything that labels (buttons, 40/32 px icon buttons, the segmented
control, chips, tags, status badges, navigation items, the navigation
counter, the load meter) and the rectangle with a small radius for
containers and fields: fields 8 px (`--r`), panels, dialogs, menus,
popovers 12 px (`--r-lg`), decision rows 10 px, role marks and role chips
6 px, availability marks 3 px, `kbd` 4 px, phone sheets 16 px at the top.
Borders are thin (1 px) in the line colour; an "on" state turns the border
to the signal (`--sig-line`), a bad state to pink. A day tile in the
availability calendar is 40 px tall with an 8 px radius. An avatar is a
circle. A 3 px accent on the left is the signature of information frames
(`.box`).

## Components

### Buttons
- **Shape:** pill (999 px), minimum height 40 px, text 600 14/21 px,
  padding 8×18 px; small 32 px, 12/16 px, 5×14 px; a 24 px icon with a
  negative margin so it does not make the button taller.
- **Touch:** under `pointer: coarse` every button, tab and segment is at
  least 44 px tall, and icon buttons, a filter chip's "×" and the event
  colours 44 px wide (one rule at the end of `styles.css`).
- **Default:** background `s1`, border `line2`, main ink; hover `s2`.
- **Primary:** action blue, white text, no border; hover
  `brightness(.95)`.
- **Danger:** `--danger` red, white text; only for irreversible actions.
- **Ghost:** no background or border, muted text; hover background `s2`.
- **Icon** (`.ib`): a 40 px circle (32 px small), border `line`, muted
  colour; "on" state in signal blue.
- **Focus:** a shared `outline: 2px solid var(--focus)` with a 2 px offset;
  disabled: `opacity: .5`.
- **Blocked:** a control that cannot act yet stays focusable
  (`aria-disabled`, the click guarded) and says why: in a panel footer the
  reason is the `.foot-status` output the button is described by, elsewhere
  a hint under the control.
- **Segmented** (`.seg`): a bordered pill, 32 px buttons, the selected one
  in action blue, variants with an availability tone (pink, grey, green) on
  a 20 % opacity background; on a phone the inbox segments (`.seg-wrap`)
  share one row in equal columns.
- **Text link button** (`.link-btn`): signal blue; inside a frame, a footer
  note or a section meta it is underlined so it reads as a link. A link that
  opens a new tab (`.ext-link`) ends with the 1 em "external" icon and says
  so in its accessible name.

### Chips
- **Style:** pill 12/16 px 600, padding 5×12 px, background `s1`, border
  `line2`, an 8 px dot on the left; the `warn`, `bad`, `ok`, `sig` tones
  change the dot and the border.
- **State:** a chip button ends with a chevron in signal blue, darkens and
  underlines its text on hover, and where it leads is said by a tooltip
  that focus opens too; a filter chip (`.filter-chip`) has the signal
  background and border and a remove button.
- **Status badge** (`.st`): a pill with a dot, background by state (draft
  `s3`, for approval `sig-soft`, published `ok-bg`, warning, error).
- **Tag** (`.tag`): a pill without a dot, background `s3`, muted text; the
  11–19 tag in `--late-text`.

### Cards / Containers
- **Corner Style:** 12 px (`--r-lg`).
- **Background:** `s1`, 1 px border `line`; in the light theme white
  without a border, with the `--shadow-sm` shadow.
- **Shadow Strategy:** none at rest (see Elevation).
- **Internal Padding:** 12×14 px (`.panel-padded`); a toolbar 8×10 px with
  a bottom line.
- **Duty card** (`.dcard`): like a panel, the role as a pill in the card
  header (no side stripe), the name 24/28 px, the duty window in mono.
- **Information frame** (`.box`): a 3 px left stripe, background `s2`, text
  12/16 px; the `warn`, `bad`, `ok`, `sig` tones colour the stripe, the
  background and the title.
- **Label and value rows** (`.roles-text`): rows whose labels are words
  rather than role marks share one label column as wide as the longest
  label (a subgrid), so a value never runs under its label.

### Inputs / Fields
- **Style:** 40 px tall, 1 px border `line2`, 8 px radius, background `s1`,
  text 14/21 px; a muted 600 12/16 px label above the field, a dim hint and
  a pink error under the field (12/16 px), both as wide as the field's row;
  required fields marked with a pink asterisk.
- **Focus:** a signal-blue border and a 3 px `sig-soft` glow, no outline.
- **Error / Disabled:** `aria-invalid` gives a pink border; disabled
  `opacity: .6`.
- **Native:** dates, months and times in Geist Mono; `<select>` with its own
  arrow `.sel-wrap::after`; a checkbox with the signal `accent-color`.

### Navigation
- **Rail** (`.rail`): control navy, 232 px, pill items 8×14 px 500; hover
  white 8 %; the active item white with navy 600 text and an action-blue
  icon; the counter in salmon with navy text; section headings 600 12 px
  muted; a footer with shortcuts.
- **"Teraz" strip** (`.now`): action blue, white text, slots with a 24 %
  white line, white role chips, the phone in mono (on the strip without the
  `+48` country code, which the `tel:` link keeps), the search as a pill
  with a 40 % white border.
- **Tabs** (`.tab`, `.sech-link`): text 600 14 px, at least 32 px tall, a
  transparent 1.5 px underline, the selected one 2 px in signal blue; the
  counter in `s3`.
- **Phone:** the top bar in action blue, five bottom tabs (icon above a
  12 px label, the active one white), a safe bottom margin.

### Overlays
- **Dialog** (`.dialog-popup`): 540 px, `s1`, border `line2`, 12 px,
  padding 16 px, title 20/24 px (pink in a `danger` dialog), muted
  description, actions aligned right; a 45 % black backdrop.
- **Side panel** (`.panel-popup`): 360 px from the right, three zones
  (header 18×20×12 px with a line, content 16×20 px, footer 12×20 px with a
  line); the modal one has a handle.
- **Toast** (`.toast`): `s3`, border `line2`, 8 px, 12/16 px, a state dot on
  the left, room for a button on the right; slides in 8 px with a 0.2 s
  fade. A toast with "Cofnij" (Undo) draws what is left of the Undo window
  as a 2 px signal-blue bar along its bottom edge that shrinks to nothing
  (hidden from screen readers); a successful Undo is confirmed by a short
  "Cofnięto" (Undone) toast.
- **Popover / menu / tooltip:** `s1`/`s3`, 12 px (tooltip 6 px),
  `--shadow-sm`, menu items 8×10 px highlighted with `s2`.

### Named Rules
**The Confirm Only the Irreversible Rule.** Only an irreversible or
destructive action asks for confirmation (a `ConfirmDialog`, a danger
button); a reversible one happens at once and offers "Cofnij" in a toast;
information is said inline, never in a modal.
**The Server-Held Undo Window Rule.** The Undo window is held by the
server, so the countdown bar does not pause: hovering or focusing the toast
keeps the toast on screen, but at the end of the window "Cofnij" goes away
and the toast says the change can no longer be undone. Pausing the
countdown on hover was considered and rejected, because the bar would then
promise time the server does not give.
**The Next Step Rule.** The draft's decision panel leads with the step the
draft needs: with hard rule violations the main action is "Popraw N
problemów" (fix N problems), which opens the cell of the first one,
followed by "Przekaż do akceptacji" (send for approval), as in mockup 03; a
clean draft leads with "Opublikuj…" (publish).
**The Past Day Rule.** A duty is past once its cover has ended, not at
midnight of its day: a working day's night on-call at 09:00 the next
morning, a day off's at midnight, 11-19 at 19:00 (`coverage.py`,
`lib/coverage.ts`). Correcting a duty that has ended (for example one
imported from history) needs a reason, asked in a field of the correction
frame rather than in a separate dialog (this supersedes the dialog of
mockup 04); each role is judged on its own, so one ended role is enough to
ask. A duty that has ended mails nobody, while the roles still in force
mail as usual; when every changed role has ended, the frame says plainly
that no one is notified.

### Duty matrix (signature component)
The table `table.m` with `--cell` cells (35 px, compact 29 px), a sticky
170 px name column and a two-row header; a cell is a borderless `.cell`
button, hover `s2`, selection as a 2 px inner frame in the focus colour.
Inside are the role marks `.rm` (32×20 px, in compact density as wide as
their content from 22 px; 6 px, 700 12 px, the role fill, navy ink) with a
correction dot or diamond, the availability mark `.am` (22 px, 3 px) and a
5 px event dot in the top right corner. A weekend has a 10 % grey wash (8 %
in the light theme), today a 12 % blue wash and the day-number pill in
action blue, a gap in staffing a pink wash. In the sticky header every wash
lies on an opaque `s2`. The start of a week is a 2 px left line.

## Do's and Don'ts

### Do:
- **Do** take every colour from a variable in `tokens.css` and every word
  from `src/i18n/pl/` (and its English counterpart in `src/i18n/en/`); a
  component knows no hex and no Polish word.
- **Do** use a pill for an element that is clicked or that labels, and an
  8/12 px rectangle for a container that is read.
- **Do** write dates, times, numbers and figures in columns in Geist Mono,
  as DD-MM-RRRR and with a decimal comma in Polish (`lib/dates.ts`,
  `lib/numbers.ts`); phone numbers through `lib/phone.ts`.
- **Do** keep the scale: 12 px for secondary content, 14 px for content,
  16 px for a section or month heading and 20/24/32 px for titles.
- **Do** mark a role with its fill colour and navy ink, the same in both
  themes.
- **Do** signal a state with a dot in a pill (`.st`, `.chip`) or a 3 px left
  stripe (`.box`, `.list-row-warn`), not by changing the whole section
  background.
- **Do** design every screen at three widths: ≤900 px (bottom tabs, bottom
  sheets), 901-1100 px (56 px rail), >1100 px.

### Don't:
- **Don't** add a shadow to a panel at rest in the dark theme; shadow is
  reserved for overlays.
- **Don't** use the action blue as a text colour or a section background;
  the text blue is `--sig`.
- **Don't** introduce a second accent, gradients (apart from the radial
  sign-in background) or coloured icons; icons are monochrome, 24 px.
- **Don't** add a component library or custom date pickers; fields are
  native (`AGENTS.md`).
- **Don't** format numbers or name days inside a component; everything
  goes through `lib/numbers.ts` and `lib/dates.ts`.
- **Don't** give the same state different colours on different screens;
  `ok`/`warn`/`bad`/`sig` is the whole state vocabulary.
- **Don't** disable a control without saying why, or confirm in a dialog
  what an Undo can take back.
