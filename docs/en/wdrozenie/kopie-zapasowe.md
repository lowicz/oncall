# Database backups

Every day at 21:00 the `oncall-backup.timer` timer takes a logical dump of the
database (`pg_dump`) inside the running `db` container, restores it as a test
in a throwaway container and only then keeps it. The 30 newest backups stay.
The backups are on the same host and are not encrypted. When a backup fails,
an e-mail goes out through the application's own SMTP settings.
`deploy/update.sh` takes the same dump before every update, because database
migrations do not roll back on their own.

Everything runs as systemd user units of the same user that runs the stack
(`podman` in production) - see [Systemd](systemd.md).

## Installing in production

The host must already run the stack with the `oncall.service` unit, and the
deployment directory must have the `deploy/backup/` directory. If it does not,
the deployment is older: first [update it](aktualizacja.md) to a release that
has it.

As the deployment user, logged in directly (not through `su` or `sudo`), from
the deployment directory:

```bash
ssh podman@host
cd ~/oncall
./deploy/backup/setup.sh --owner podman --alert-email admin@example.com
```

The script is idempotent. In order, it:

1. Checks that it is run by the `--owner` user (by default whoever runs it),
   not root, and that this user's systemd runs `oncall.service` from the same
   directory. The backups belong to this user and to nobody else.
2. Checks linger and, when it is off, tries to turn it on - see
   [below](#linger-and-user-units).
3. Writes the settings to `~/.config/oncall/backup.conf` (mode `0600`).
4. Creates the backup directory with mode `0700`, or checks that an existing
   one belongs to the owner, and closes it.
5. Checks the stack: the `db` container, its readiness and the application's
   SMTP server.
6. Installs `oncall-backup.service`, `oncall-backup-alert.service` and
   `oncall-backup.timer` in `~/.config/systemd/user/`, with drop-ins: one
   points at the deployment directory, the other carries the backup time
   (`oncall-backup.timer.d/time.conf`); enables the timer.
7. Takes a backup the way the timer will
   (`systemctl --user start oncall-backup.service`) and shows its state.

Without `--alert-email` the alerts go to the application's active
administrators that have an e-mail address. Running it again changes only the
values given; the rest comes from the settings file.

### Is update.sh enough

Not by itself. `deploy/update.sh` delivers the `deploy/backup/` files with the
release, dumps the database before every update (even without the timer
installed) and refreshes backup units already installed when the release
changes them. It does not, however, create the backup directory, write the
settings, enable the timer or check linger: those are decisions and
permissions an unattended `curl ... | sh` should not take for the operator.
That is why the installation is a one-time `setup.sh`, and `update.sh` then
keeps it current.

### Linger and user units

Rootless Podman containers belong to one user and only that user sees them,
so the dump has to be taken by the same user that runs the stack, in that
user's systemd manager - like `oncall.service`. A system unit with
`User=podman` does not have that user's session (`XDG_RUNTIME_DIR`, the user's
systemd manager), which rootless Podman relies on.

The user's systemd manager runs without a login only with linger on. Without
it the timer stops working when the user logs out and does not start after a
machine restart. `install-user-unit.sh` turns linger on when the stack is
installed; `setup.sh` checks it again. When the user cannot turn it on (polkit
policy), an administrator does:

```bash
sudo loginctl enable-linger podman
```

## Settings

The `~/.config/oncall/backup.conf` file is written by `setup.sh`. It holds
`KEY=value` lines, read on every backup run (not through `source`). An
environment variable of the same name takes precedence over the file.

| Setting | `setup.sh` option | Default | Meaning |
| --- | --- | --- | --- |
| `ONCALL_BACKUP_OWNER` | `--owner` | the user running it | The only user that may take backups and that owns the directory |
| `ONCALL_BACKUP_DIR` | `--backup-dir` | `~/oncall-backups` | The backup directory, outside the deployment directory |
| `ONCALL_BACKUP_KEEP` | `--keep` | `30` | How many of the newest backups stay |
| `ONCALL_BACKUP_ALERT_EMAIL` | `--alert-email` | the active administrators' addresses | Alert recipients, separated by commas |
| `ONCALL_BACKUP_TIME` | `--backup-time` | `21:00` | When the daily backup starts (`HH:MM`, host time), at most 15 minutes later |
| `ONCALL_BACKUP_WAIT_SECONDS` | - | `600` | How long a backup waits for the database, e.g. when the timer fires at machine start before the stack is up |

Changing a setting is running `setup.sh` again with the new value, e.g.
`./deploy/backup/setup.sh --keep 60`. The new value applies from the next
backup; surplus old backups go at the next successful backup.

The backup time is `ONCALL_BACKUP_TIME` in the host's time zone, with a
random delay of up to 15 minutes. `setup.sh` writes it into the drop-in
`~/.config/systemd/user/oncall-backup.timer.d/time.conf`, so an update that
refreshes the timer itself does not change it. Another time applies at once:

```bash
./deploy/backup/setup.sh --backup-time 23:30
```

## Verification

Whether the timer is enabled and when it fires next:

```bash
systemctl --user list-timers oncall-backup.timer
```

Whether the last backup succeeded, how many there are and whether there was
an error:

```bash
./deploy/backup/oncall-backup.sh status
./deploy/backup/oncall-backup.sh list
journalctl --user -u oncall-backup.service
```

`journalctl --user` works only with a journal kept on disk. Without the
`/var/log/journal` directory (a journal kept in memory only), the user gets
“No journal files were opened due to insufficient permissions”, and the
journal is gone after a machine restart. `setup.sh` reports it, and
`oncall-backup.sh status` shows the last error regardless of the journal. An
administrator turns on the persistent journal, in which every user reads
their own entries:

```bash
sudo mkdir -p /var/log/journal
sudo systemd-tmpfiles --create --prefix /var/log/journal
sudo systemctl restart systemd-journald
```

A backup now, exactly as the timer takes it:

```bash
systemctl --user start oncall-backup.service
```

Whether the alert arrives - a test e-mail to the configured recipients:

```bash
./deploy/backup/oncall-backup.sh alert --test
```

Whether linger is on (`Linger=yes`):

```bash
loginctl show-user podman --property=Linger
```

## What a backup holds

One backup is one file `oncall-<UTC time>-<kind>-<schema revision>.dump` in
the `pg_dump --format=custom` format, compressed with zstd, e.g.
`oncall-20260926T023412Z-daily-0035_outbox_created_index.dump`. The kind is
`daily` (the timer), `pre-update-<from>-to-<to>` (an update), `pre-restore`
(the state before a restore) or `manual`. They all count towards the same
pool of newest backups.

A backup is the database only. `.env` and `tls/` hold passwords and the TLS
private key and are not part of the backup: `update.sh` keeps their previous
versions in `.backup/`, and their place is the organisation's password vault.

The database holds personal data (names, e-mail addresses, phone numbers,
personnel numbers) and the password hashes of local accounts. The backup
directory has mode `0700`, the files `0600`, and the script refuses to work
when the directory belongs to someone else or is open to others. The backups
are local only: a disk failure or the loss of the machine takes the database
together with its backups. The backup directory is plain files, so an
organisation's backup system can cover it without any change to the script.

## Restore test and cleanup

Every dump is restored in full (`pg_restore` in one transaction) in a
throwaway container of the running database's image before it reaches the
backup directory. The container has no network, a read-only file system and
keeps its data in tmpfs: the test takes no disk space, only as much memory as
the database weighs, for a moment. A file that does not restore, or does not
bring back every table of the database, is not kept. `pg_restore --list`
alone is not enough: it succeeds on a truncated file. `verify` and `restore`
restore a kept backup the same way but compare it with its own list of
tables, because the database schema may have changed since.

After every run, successful or not, the script removes its test container
together with its volumes. When the process is killed before it can do so,
the unit's `ExecStopPost` cleans up, and as a last resort the next run does;
it also records the step the backup was stopped in, so that the alert says so.
It removes only containers carrying the script's own label
(`io.github.lowicz.oncall.backup-verify`) for this deployment and its own
unfinished `.tmp.*` files - it never calls `podman system prune`. The same by
hand:

```bash
./deploy/backup/oncall-backup.sh cleanup
```

## Restoring the database

```bash
./deploy/backup/oncall-backup.sh list
./deploy/backup/oncall-backup.sh restore ~/oncall-backups/oncall-20260926T023412Z-daily-0035_outbox_created_index.dump
```

The script asks for confirmation (without a terminal it requires `--yes`), and
then:

1. restores the file as a test in a throwaway container - a file that does
   not restore changes nothing,
2. backs up the current state (`pre-restore`), so the restore can be undone
   with the same command,
3. stops `api`, `worker` and `web` - the application is unavailable then,
4. restores the file into a new database alongside and swaps the databases by
   name, so an error on the way leaves the existing database untouched,
5. starts them again, also after an error; `web` last, so that nginx finds
   the restarted `api`.

At start `api` applies the migrations newer than the backup's schema. A
backup with a newer schema than the running release needs that release first.

## Before an update

`deploy/update.sh` takes a dump of the `pre-update-<from>-to-<to>` kind after
pulling the images and before changing any file. It uses the backup script of
the deployment directory, and when there is none (the first update to a
release with backups), the new release's script. A failed dump ends the update
without any change. The stack must be running then: the script waits for the
database for at most 60 seconds.

## When a backup fails

The `oncall-backup.service` unit ends with an error and starts
`oncall-backup-alert.service`, which sends an e-mail with the host name, the
step that failed and the last messages. The e-mail goes out through the `api`
container (or `worker`, when `api` is not running), with the `ONCALL_SMTP_*`
settings from `.env`; without `ONCALL_SMTP_HOST` the alert cannot be sent. The
earlier backups stay untouched.

The details are shown by `./deploy/backup/oncall-backup.sh status` (the last
error) and `journalctl --user -u oncall-backup.service`. The most common
causes:

- the stack is not running (`systemctl --user status oncall`),
- no disk space in the backup directory,
- the backup directory changed its owner or mode - the script names the
  command that fixes it.

Once the cause is gone, a backup now is `systemctl --user start
oncall-backup.service`.
