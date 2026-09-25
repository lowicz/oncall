# Getting started

## Signing in

1. Open the application address given to you by the administrator.
2. Enter your **username** and **password**, then “Sign in”.
3. The “Show password” button reveals the characters you type, if you want to
   check them.

If your company has directory sign-in enabled (LDAP / Active Directory), use
the same credentials as for your computer. The account is created on the first
successful sign-in.

The message **“Wrong username or password”** also appears when the account
has been disabled - in that case contact the administrator.

## Password

- The password must be **at least 12 characters** long.
- There is no self-service “forgot my password”. Ask the administrator for a
  **one-time reset link**; it opens the screen for setting a new password.
- The activation link for a new account works the same way.
- Directory accounts have no local password - you change it where you usually
  do.

## What you see after signing in

On a wide screen the **navigation rail** is on the left, from the top:

- the `E/` mark with the application name set by the administrator (with the
  subtitle under it, if one is set),
- the everyday screens: **Now**, **Schedule**, **Mine**, **Swaps**,
- the **Coordination** section: **Generator**, **Fairness**, **Monthly
  report**, **History import**,
- the **Administration** section: **People**, **Events**, **Share links**,
  **Audit**,
- at the bottom the **Documentation** link, the **Palette** button (`Ctrl K`)
  and the application version number.

Only the items you have permission for are visible. The number of swaps
waiting for your decision appears as a badge next to the “Swaps” item.

Above the content of every screen runs the **On duty now** strip: who has
`PRIMARY`, `SECONDARY` and `11–19` today, with their phone number and the time
left until the end of the duty, the **Search…** field that opens the command
palette, and your avatar: your photo from the company directory, if your
account has one, or your initials. Clicking the avatar opens the account menu:
name and role, theme, matrix density, language, a link to the documentation,
the command palette, **Sign out** and, at the very bottom, the version number
of the application that is currently running (the same as at the bottom of
the rail).

On a phone the rail disappears and the bottom of the screen has the tabs
**Now**, **Schedule**, **Mine**, **Swaps** and **More**. Under “More” are the
remaining screens of your role, the theme, density, language, documentation,
sign-out and the version number.

## Command palette

`Ctrl K` (`⌘ K` on a Mac), the **Search…** field or the **Palette** button
opens the palette. Type:

- a surname - it opens the schedule with that person's row highlighted,
- a day (`24 Sep`, `24.09`, `24-09-2026` or `2026-09-24`) - it opens the
  schedule with that day's panel,
- the name of a screen or an action: theme, documentation, sign-out.

The arrow keys pick an item, `Enter` runs it, `Esc` closes the palette.

## Theme, density and language

In the account menu (on a phone, on the “More” screen) you choose the theme:
**Dark** (the default), **Light** or **System**, which follows the operating
system setting. **Matrix density** shrinks the schedule cells so that a
longer range fits without scrolling. Both choices are remembered in the
browser and apply in this documentation too.

In the same place you choose the **Language** of the interface: **Polski**
(the default) or **English**. The same switch is under the sign-in form. The
choice is remembered in the browser, also covers messages from the server
(refusals, validation errors, holiday names) and leads to the documentation
in the chosen language; a new user always starts in Polish, regardless of
the browser settings.

## Date format

Dates in the application are displayed as **`DD-MM-YYYY`**, regardless of the
language settings of your computer. Date fields in forms are the browser's
date fields: you type the date in the layout the field suggests, or pick the
day from the browser's calendar. The field does not accept a date that does
not exist, and where a form has a range, the **To** field does not let you
pick a day before **From**. The month in the monthly settlement report is
picked the same way.

## Accessibility

The application targets WCAG 2.2 AA:

- everything works from the keyboard, and focus is visible,
- the calendar matrix has a tabular alternative and a mode for small screens,
- status is always conveyed as **text**, never by colour alone,
- the system's “reduce motion” setting is respected.
