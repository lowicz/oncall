# Enabling number forwarding

This page walks through enabling the automatic forwarding of the on-call
number through Orange WCO on a running deployment, step by step, from the
release update to working in **On** mode. How the feature works is in
[Integrations](../produkt/integracje.md#on-call-number-forwarding-orange-wco),
and the screen in
[Administration](../uzytkownik/administracja.md#number-forwarding-przelaczanie-administrator).

After the update forwarding is off (mode **Off**) and nothing changes until
an application administrator turns it on. The steps up to and including the
[key](#encryption-key) are for the host administrator, in the deployment
directory (`~/oncall`); the rest are for an application administrator on the
**Number forwarding** screen (`/przelaczanie`).

## Checklist

1. `.env` assigns none of `ONCALL_LDAP_CA_FILE`, `ONCALL_SMTP_CA_FILE`,
   `ONCALL_WCO_CA_FILE` and `ONCALL_TLS_CA_FILE`; the trusted CAs are in one
   `ONCALL_CA_FILE` ([Before the update](#before-the-update)).
2. The unit's drop-in names no old CA overlay, only
   `docker-compose.ca.yml`.
3. A test alert e-mail arrives, and the coordinators and administrators
   have e-mail addresses.
4. The local administrator account works and its password is in the
   vault.
5. Release updated, directory sign-in works ([Updating](#updating)).
6. `ONCALL_SECRETS_KEY` set and kept in the vault
   ([Key](#encryption-key)).
7. Everyone in the rotation has a number in the `+48500500500` format
   ([Phone numbers](#phone-numbers)).
8. WCO account saved, **Check connection** answers “The connection works”
   ([WCO account](#wco-account-and-connection-check)).
9. One end-to-end reveal of the WCO password, with a “WCO password
   revealed” entry in the Audit trail ([Switching by hand](#switching-by-hand)).
10. **Dry run** mode for at least three working days without failures
    ([Dry run](#dry-run)).
11. Confirmation before going live
    ([Confirmation](#confirmation-before-going-live)).
12. **On** mode on a working day before the reminder hour, with someone
    watching the switch ([Going live](#going-live)).

## Before the update

The release with number forwarding reads every trusted CA from one file,
`ONCALL_CA_FILE`, and the `docker-compose.ca.yml` overlay -
[One CA file](aktualizacja.md#one-ca-file). As long as `.env` or the unit
uses the old names, `update.sh` refuses and changes nothing. Check both
places before the update:

```bash
cd ~/oncall
grep -nE '^(export )?ONCALL_(LDAP|SMTP|WCO|TLS)_CA_FILE=' .env
systemctl --user cat oncall | grep ONCALL_COMPOSE_FILES
```

- **`.env`**: a deployment updated earlier by `update.sh` has the line
  `ONCALL_TLS_CA_FILE=./tls/ca.pem` from the former `.env.example`. Delete a
  line with the path `./tls/ca.pem`. Turn any other path into
  `ONCALL_CA_FILE=<path>`; when several variables named different files,
  join them into one PEM bundle, e.g.
  `cat /etc/pki/company-root.pem /etc/pki/company-ad.pem > tls/ca.pem`.
- **Drop-in**: when `ONCALL_COMPOSE_FILES` names
  `docker-compose.ldap-ca.yml`, `docker-compose.smtp-ca.yml` or
  `docker-compose.wco-ca.yml`, `update.sh` prints a ready `sed` command that
  replaces them with one `docker-compose.ca.yml`, and
  `systemctl --user daemon-reload`. Run them and run the update again right
  away: until it finishes the unit does not start
  (`missing docker-compose.ca.yml`). Without that line the unit starts the
  default three files and nothing needs changing.

The CA file (`./tls/ca.pem` by default) must exist with mode `0644` -
[CA file](uruchomienie.md#ca-file). The connection to WCO is always
verified; `wco.orange.pl` has a certificate from a public CA, so a company
CA is needed only behind a TLS proxy. The `worker` (forwarding) and `api`
(**Check connection**) containers must reach `https://wco.orange.pl` (port
443).

The alert about a failed switch is an e-mail, so SMTP must work. The backup
test alert, sent to its recipients, checks that:

```bash
./deploy/backup/oncall-backup.sh alert --test
```

The alert goes to the active coordinators and administrators who have an
e-mail address, and to the person on PRIMARY; an account without an address
gets nothing.

Keep the local administrator account: `ONCALL_ADMIN_USERNAME` and
`ONCALL_ADMIN_PASSWORD` in `.env` create and synchronise it on every `api`
start ([Administrator account](uruchomienie.md#administrator-account)). Keep
its password in the organisation's vault. When the LDAP directory and
forwarding fail together, only this account can reveal the WCO password.

## Updating

`update.sh` with the release number does the update -
[Updating a deployment](aktualizacja.md). `.env` gains an empty
`ONCALL_SECRETS_KEY` (the script prints `added ONCALL_SECRETS_KEY`) and a
commented-out `ONCALL_LDAP_ATTRIBUTE_PHONE`. The migrations at `api` start
store existing phone numbers as `+48` and nine digits where they can.

After the update check a directory sign-in and the test alert, as above.
Forwarding stays off.

## Encryption key

The WCO password is stored in the database encrypted with the Fernet key in
`ONCALL_SECRETS_KEY`. Without the key the screen neither stores a password
nor turns forwarding on. The application image prints a new key:

```bash
cd ~/oncall
podman compose exec api python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Put it in `.env` and restart the stack:

```bash
# in .env: ONCALL_SECRETS_KEY=<the key printed above>
systemctl --user restart oncall
```

A value that is not a Fernet key stops `api` and `worker` from starting;
the log says which comma-separated entry is wrong.

**Keeping the key.** Store the key in the organisation's vault together with
`.env`. Database dumps do not hold it
([What a backup holds](kopie-zapasowe.md#what-a-backup-holds)), and a
restored database without the same key has an unreadable WCO password. The
key protects a value an administrator can reveal, so its boundary is the
same as an administrator account's.

**What is lost without the key.** Only the WCO password (and the pending
one during a change). The worker then records the failure „Konfiguracja WCO
jest niekompletna lub niedostępna” (WCO configuration incomplete or
unavailable), and **Show password** and **Check connection** refuse. In
**On** mode the worker changes an expired password itself, so the
application may be the only place that knows the current password: after
losing the key it has to be found out or reset with Orange, a new key set
and the password entered in the **WCO password** field. The schedule,
accounts and all other data do not depend on the key.

**Rotating the key.** Put the new key first (`new,old`) and restart the
stack. Reveal the password, enter it through **Change password** and
**Save** - saving encrypts it under the new key. Then remove the old key and
restart the stack again. Do this while the **State** card shows no password
change under way.

## Phone numbers

The forwarding target is the phone on the account of the person on PRIMARY,
stored as `+48` and nine digits (`+48500500500`) and sent to WCO unchanged.
On the **People** screen the **In the rotation** filter shows everyone who
can get PRIMARY: a missing number is red in the phone column, and a number
in another format is marked “fix the number”. An administrator corrects it
in the person's panel, or the person on the [Mine](../uzytkownik/dostepnosc.md#my-phone)
screen. Optionally `ONCALL_LDAP_ATTRIBUTE_PHONE` fills an empty number from
the directory at sign-in - [Phone number](ldap.md#phone-number).

When the person on PRIMARY has no number, the worker changes nothing in WCO
and, in **On** mode, sends an alert.

## WCO account and connection check

On the **Number forwarding** screen, with mode **Off**:

1. Enter the **Switchboard number**, **Login**, **WCO user id** (the WCO
   user whose number is the forwarding target) and **WCO password**. The
   **WCO address** stays `https://wco.orange.pl`. Click **Save**.
2. Click **Check connection**. The expected result is “The connection
   works. WCO now forwards to +48…”, with the number the on-call number is
   switched to by hand at the moment.

The check logs in to WCO and only reads; the Audit trail gets a “Number
forwarding checked” entry. The other results are in
[Troubleshooting](#troubleshooting). Do not repeat the check with a password
WCO refused: more failed logins may lock the WCO account.

## Dry run

Set **Mode** to **Dry run** and click **Save**. Within a few seconds the
worker logs in to WCO, reads the number and records what it would set,
changing nothing in WCO. It does so once per duty day, at the reminder hour
(`ONCALL_HANDOVER_REMINDER_HOUR`, 9:00 by default), and again after a
schedule correction or a settings change. This mode sends no alert e-mails.

You read the result in two places:

- the **State** card: **Target** (the person on PRIMARY, their number, the
  duty day), **WCO forwards to** (the number WCO holds now) and **Outcome**
  “dry run, nothing changed”;
- the **Audit** trail, action “Number forwarding checked”, actor `system`:
  „Próba przełączenia numeru na \<person>” (a forwarding attempt to the
  person; summaries are recorded in Polish), and under **Details** `day`,
  `desired_number` (what the worker would set) and `current_number` (what WCO
  holds). Entries of the same action with an administrator as the actor are
  manual **Check connection** runs.

Every day check that `desired_number` is the number of the person on
PRIMARY in the **Schedule**, and that `current_number` has the same format
(`+48` and nine digits) as the numbers in the application. “Number
forwarding failed” and “Number forwarding skipped” entries show what would
fail in **On** mode - the cause is in the entry's summary. In dry run the
worker does not change an expired password: it records a failure and tries
again after an hour.

## Confirmation before going live

The deployment's owner turns on **On** mode when:

- **Dry run** ran for at least three working days, and every day
  `desired_number` matched the schedule with no failures;
- the format of `current_number` from WCO is the same as the numbers in the
  application, so a switch does not change how WCO stores the number;
- every earlier item of the [checklist](#checklist) is ticked;
- the coordinators know that from now on they do not switch the number by
  hand, and that after an alert they follow
  [Switching by hand](#switching-by-hand).

Pick a working day and a moment before the reminder hour, with someone who
watches the **State** card and the Audit trail at that hour.

## Going live

Set **Mode** to **On** and click **Save**. Saving resets the state of the
previous mode, so the worker acts within a few seconds:

- before the reminder hour the target is the previous day's PRIMARY, who is
  on duty until that hour;
- when WCO already forwards to the target's number, **Outcome** is
  “unchanged” and there is no Audit entry;
- otherwise the worker changes the number, reads it back from WCO as
  confirmation, **Outcome** is “switched”, and the Audit trail gets “On-call
  number forwarded” („Numer on-call przełączono na \<person>”).

At the reminder hour the worker switches the number to today's person on
PRIMARY. Check the **State** card and the Audit trail then, and call the
on-call number to make sure that person's phone rings.

From then on the first-day reminder of a PRIMARY duty says „Numer on-call
jest przełączany automatycznie o 09:00. Jeśli połączenia nie docierają,
skontaktuj się z koordynatorem.” (the number switches automatically; tell a
coordinator when calls do not arrive) instead of „Pamiętaj o przełączeniu
numeru on-call.” (remember to switch the number). After a successful switch
the worker reads WCO again only when the number to set changes: at the next
reminder hour, after a schedule correction or swap that changes the person
on PRIMARY or their number, and after a change to the forwarding settings is saved. A
number changed by hand in the WCO panel to one other than the PRIMARY's
stays until then, and the worker overwrites it at that point. To keep a
manual number, set the mode to **Off**.

## Alert e-mail

When a switch fails in **On** mode, the worker sends a message (e-mails are
in Polish):

- subject „Pilne: numer on-call nie został przełączony”, title „Numer
  on-call wymaga pilnej interwencji”;
- facts: **Dzień dyżuru** (duty day), **PRIMARY**, **Numer docelowy**
  (target number) and **Ostatni numer WCO** (last WCO number), both masked,
  e.g. `+48 500 *** 500`, **Potwierdzony** (when WCO last confirmed a number)
  and **Przyczyna** (cause);
- the instruction „Przełącz numer ręcznie i sprawdź ustawienia
  przełączania.” (switch the number by hand and check the forwarding
  settings), with a **Przełącz numer ręcznie** button to `ONCALL_SWITCH_URL`
  (when set) and a **Sprawdź przełączanie** link to `/przelaczanie`.

It goes to the active coordinators and administrators with an e-mail
address and to the person on PRIMARY. When it goes out, and when the
recovery message follows, is in
[Integrations](../produkt/integracje.md#on-call-number-forwarding-orange-wco).

## Switching by hand

When the automation fails, an administrator reveals the WCO password and
switches the number in the WCO panel - the full procedure:
[Switching the number by hand](../uzytkownik/administracja.md#switching-the-number-by-hand).

Before going live do one reveal (**Show password**) end to end, including
the login to the WCO panel without changing the number, and find the “WCO
password revealed” entry in the Audit trail.
Do it with the local administrator account, to test the path for an LDAP
outage.

## WCO password changes

In **On** mode the worker changes the password itself when WCO reports it
expired: it sets a new one (20 characters, four character classes), storing
it as pending first, and adopts it after a successful login. The Audit trail
gets “WCO password changed” and the **State** card a date under **WCO
password changed**. Nobody gets an e-mail about it; only the application
knows the current password, and **Show password** shows it. A password WCO
rejects under its policy is replaced with a new one, at most three times per
pass; then the worker sends an alert with the cause „Hasło WCO wygasło, a
jego automatyczna zmiana nie powiodła się” (expired, and the automatic
change failed).

Do not change the password in the WCO panel unless you must. When you must,
enter the new one in the **WCO password** field at once: otherwise the
worker's login is refused, it shows “Passwords refused”, stops logging in so
as not to lock the WCO account, and sends an alert. Entering a password
lifts that stop.

## Rolling back

Set **Mode** to **Off** and click **Save**. The worker stops connecting to
WCO on its next pass, within a few seconds. WCO stays on the number set
last, and the number is switched by hand again; the first-day reminder goes
back to „Pamiętaj o przełączeniu numeru on-call.”. The settings and the
password stay stored, so enabling again starts with the [dry run](#dry-run).
Rolling back the release is not needed for this.

## Troubleshooting

| Symptom | Cause | What to do |
| --- | --- | --- |
| `update.sh` ends with `.env sets ONCALL_..._CA_FILE` or `runs per-feature CA overlays` | old CA configuration | [Before the update](#before-the-update) |
| `api` and `worker` do not start, log `ONCALL_SECRETS_KEY entry N is not a Fernet key` | bad key | generate a key with the command in [Encryption key](#encryption-key) |
| **Save**: “The WCO password is stored encrypted and the server has no key” | `ONCALL_SECRETS_KEY` missing | set the key and restart the stack |
| “No key in ONCALL_SECRETS_KEY decrypts the stored WCO password” | the key the password was encrypted with was removed | put that key back as a second entry, or enter the password again |
| “Changing the WCO address requires entering the password again” | **WCO address** changed | enter the password together with the new address |
| **Check connection**: “A verified connection to WCO cannot be opened: check ONCALL_CA_FILE.” | the CA file is missing or unreadable | [CA file](uruchomienie.md#ca-file), then restart |
| **Check connection**: “Could not connect to WCO.” | network, firewall, WCO outage | check that `api` and `worker` reach `https://wco.orange.pl`; the worker retries by itself |
| **Check connection**: “WCO refused the stored login details.” | wrong switchboard number, login or password | correct them and enter the password again; do not retry blindly |
| **Check connection**: “The login works, but the WCO password has expired.” | the password expired | in **On** mode the worker changes it; in another mode change it in the WCO panel and enter it in **WCO password** at once |
| **State**: “Passwords refused”, **Check connection** disabled | WCO refused every stored password | find the right password and enter it in **WCO password** |
| **Outcome**: “skipped: no number” | the person on PRIMARY has no number | add the number ([Phone numbers](#phone-numbers)) |
| **Outcome**: “skipped: nobody on PRIMARY” | a day without PRIMARY in the published schedule | fill in and publish the schedule |
| **Cause**: „WCO odrzuciło zmianę numeru” (number change refused) | wrong **WCO user id**, or a number WCO does not accept | check the id and the person's number; switch by hand |
| **Cause**: „Konfiguracja WCO jest niekompletna lub niedostępna” | key missing, password unreadable, or CA file | the rows above about the key and the CA file |
| no alert arrived | SMTP off, or a recipient without an e-mail address | [Before the update](#before-the-update); **Dry run** sends no alerts |
| a number set by hand goes back to the schedule's number | **On** mode overwrites the manual number at the next switch ([Going live](#going-live)) | set **Off** if the manual number has to stay |
