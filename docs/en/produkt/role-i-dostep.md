# Roles and access

## Four roles

| Role | Label in the application | Scope |
| --- | --- | --- |
| `viewer` | Viewer | only the published schedule |
| `member` | Team member | viewing plus own availability, swaps and balance |
| `coordinator` | Coordinator | generation, corrections, publication, swap approval, reports, import |
| `admin` | Administrator | everything above plus accounts, eligibility, events, share links and audit |

The roles are cumulative: an administrator sees everything a coordinator does.

## What each role sees

| Screen (path) | viewer | member | coordinator | admin |
| --- | :---: | :---: | :---: | :---: |
| Now (`/`) | yes | yes | yes | yes |
| Schedule (`/grafik`) | yes | yes | yes | yes |
| Mine (`/moje`) | no | yes | yes | yes |
| Swaps (`/zamiany`) | no | yes | yes | yes |
| Generator (`/generator`) | no | no | yes | yes |
| Fairness (`/sprawiedliwosc`) | no | only themselves | whole team | whole team |
| History import (`/import`) | no | no | yes | yes |
| Monthly report (`/raporty`) | no | no | yes | yes |
| People (`/osoby`) | no | no | no | yes |
| Events (`/wydarzenia`) | no | no | no | yes |
| Share links (`/udostepnienia`) | no | no | no | yes |
| Audit (`/audyt`) | no | no | no | yes |

Navigation items unavailable to a role simply do not appear. Entering the
address of a screen outside your permissions takes you to the “Now” screen;
regardless of that, every API request is checked on the server side. **The
interface is not a security boundary.**

The coordinator and the administrator have access to the “Mine” screen even
when they are not in the rotation themselves: that is where they file
availability on behalf of a person who cannot do it themselves.

## What a viewer will never see

- drafts and generator results,
- availability and the reasons for unavailability (this is private data),
- points, balance and fairness forecasts,
- swap requests,
- generation settings and the audit,
- the e-mail addresses of the people on duty (they see the phone of the person on duty, to be able to call).

The reason for unavailability is private between team members too: it is seen
by the author of the entry and by the coordinator and the administrator.

## Accounts and sign-in

- **Local account** - username and password (at least 12 characters), Argon2id hash.
- **Directory account (LDAP / Active Directory)** - optional, off by
  default. The first successful sign-in from the directory creates an active
  `viewer` account keyed by personnel number; later ones synchronise the
  username, first name, last name and e-mail, leaving the locally managed
  role, status, rotation and eligibility alone.
- **Linking a local account with the directory** happens automatically on the
  first sign-in from the directory if **the account's personnel number matches
  `employeeNumber`**. Once linked, the local password stops working. A
  mismatched number ends in a `409` conflict recorded in the audit - the
  administrator fixes it on the account.

The session is an `HttpOnly`, `Secure`, `SameSite=Lax` cookie with CSRF
protection on state-changing operations. Signing out invalidates the session
immediately.

## Temporary access without an account

The administrator can issue a **share link** tied to a recipient, a date range
and an expiry date (at most 30 days). Opening `/share/{token}` exchanges the
one-time token for a limited session and removes the token from the address
bar. Such a session:

- sees only the published schedule cut down to the link's range,
- sees who is on duty now and under which phone number, as long as today
  falls within the link's range,
- expires together with the link,
- stops working immediately once the link is revoked.

The permanent form of access remains a named `viewer` account; the temporary
link is the exception.
