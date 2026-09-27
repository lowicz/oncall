# Updating a deployment

The `deploy/update.sh` script moves an existing deployment to the given
release with one command: it fetches that release's Compose files, adds the
new variables to `.env`, pulls the images and restarts the systemd user unit.
It is intended for a host where the stack runs under Podman as the
`oncall.service` unit - see [Systemd](systemd.md).

## The command

As the deployment user (e.g. `podman`), a specific release:

```bash
curl -fsSL https://raw.githubusercontent.com/lowicz/oncall/main/deploy/update.sh |
  sh -s -- 1.2.3
```

Without a number the script takes the latest stable release:

```bash
curl -fsSL https://raw.githubusercontent.com/lowicz/oncall/main/deploy/update.sh |
  sh
```

`sh -s --` passes the number to a script read from standard input; a bare
`| sh 1.2.3` would treat the number as a file name. A number with the `v`
prefix (`v1.2.3`) works too. A pre-release, e.g. `1.3.0-rc.1`, always has to
be given explicitly - “latest stable” does not include it.

The script from the `main` branch deploys every release, including ones older
than itself. Whoever prefers to read first what they are about to run
downloads the file and runs it locally:

```bash
curl -fsSLO https://raw.githubusercontent.com/lowicz/oncall/main/deploy/update.sh
sh update.sh 1.2.3
```

In a directory that is a git checkout the same file is at
`deploy/update.sh`.

## Assumptions

- The deployment directory is `~/oncall`. A different one is given by
  `--dir /path` or the `ONCALL_DIR` variable.
- The directory contains `docker-compose.yml`, `.env` and `deploy/systemd/oncall-stack.sh`.
- The `oncall.service` unit is installed with the
  `deploy/systemd/install-user-unit.sh` script, and its `WorkingDirectory` is
  that same directory. The script checks this and does not restart a unit
  that runs a different directory.
- The host has `podman`, `systemctl` and `curl`, and in a git checkout also
  `git`.
- The script is run by the deployment user, not root, logged in directly
  (`ssh podman@host` or `machinectl shell podman@`). After `su` or `sudo` the
  user's systemd manager is often unreachable; the script then sets
  `XDG_RUNTIME_DIR=/run/user/<uid>` itself, and when that is not enough, it
  says how to log in.

The script does not set up a deployment from scratch: the first start is
described in [Running the stack](uruchomienie.md) and [Systemd](systemd.md).

## What it does

1. Checks the directory, `.env`, the commands and the installed unit.
2. Fetches from the `vX.Y.Z` tag the three Compose files (`docker-compose.yml`,
   `docker-compose.tls.yml`, `docker-compose.ldap-ca.yml`), `.env.example` and
   the `deploy/systemd/` and `deploy/backup/` files. When the directory is a git checkout, it does
   `git fetch --tags` and a `git checkout` of the tag instead.
3. Builds the new `.env` - see [below](#how-env-changes).
4. Pulls the `ghcr.io/lowicz/oncall-api` and `ghcr.io/lowicz/oncall-web`
   images in that version, and PostgreSQL's image too when the release
   changes its major version. If the release does not exist, the script stops
   here and changes nothing; nor does the restart later wait for the pull.
5. Dumps the database, proved by a restore, because the restart runs the
   release's migrations and they do not roll back on their own - see
   [Database backups](kopie-zapasowe.md#before-an-update). A failed dump ends
   the update without any change. A release with a newer PostgreSQL major
   version moves the database in this step - see
   [A new PostgreSQL major version](#a-new-postgresql-major-version).
6. Makes a [backup](#backup-and-rollback) of every file it will change and
   writes the new files. A file identical to the release's is left untouched.
7. Restarts the unit - see [Restarting the unit](#restarting-the-unit).

The script does not touch the `tls/` directory or the units' drop-ins, removes
no volume, and does not install the backup timer (`deploy/backup/setup.sh` does
that once, and the script reminds you at the end until the timer is there). Running it again with the same number changes no file, dumps the
database and restarts the unit.

## How .env changes

- The new file has the layout and comments of the new release's `.env.example`.
- Every variable assigned in the current `.env` keeps its line **verbatim**:
  the value, even an empty one, quotes, the `export` prefix, a multi-line
  value. A variable assigned twice keeps both lines.
- The only changed value is `ONCALL_VERSION`, set to the release being
  deployed.
- A variable new in the release gets its default value and comment from
  `.env.example`; the script prints its name (`added ...`) so that it can be
  reviewed.
- A variable that `.env.example` shows only as a comment, e.g.
  `# ONCALL_LDAP_CA_FILE=./tls/ca.pem`, goes in place of that line.
- Variables that `.env.example` does not have (your own, or removed from the
  release) stay at the end of the file under the header
  `# Kept from the previous .env: not in .env.example.`, together with the
  comment directly above them. The script prints them as `kept ...`.
- Your own comments on variables from `.env.example` give way to the
  release's comments; the original stays in the backup.
- The file's permissions (e.g. `0600`) are kept. The file is written through a
  temporary file and replaced as a whole.

Before writing, the script checks that every assignment line from the old
`.env` (other than `ONCALL_VERSION`) is in the new one. If not, it aborts
without changes.

A preview of the new `.env` without any change on the host:

```bash
curl -fsSL -o /tmp/env.example https://raw.githubusercontent.com/lowicz/oncall/v1.2.3/.env.example
curl -fsSL https://raw.githubusercontent.com/lowicz/oncall/main/deploy/update.sh |
  sh -s -- merge-env ~/oncall/.env /tmp/env.example 1.2.3
```

## Backup and rollback

Before a change the script copies every file it changes to
`~/oncall/.backup/<date>-<time>/` (a directory with `0700` permissions):
`.env`, the Compose files and `deploy/systemd/` with their paths, and the
installed unit to the `unit/` subdirectory. A run that changes nothing leaves
no directory. The backups contain the secrets from `.env` - delete old ones by
hand.

A rollback is the same script with the previous number (except going back
before [a new PostgreSQL version](#going-back-after-a-postgresql-upgrade)).
The script prints it at the beginning of every run (`On-call in ~/oncall: 1.2.3 -> 1.2.4`) and also
suggests it when the restart fails:

```bash
curl -fsSL https://raw.githubusercontent.com/lowicz/oncall/main/deploy/update.sh |
  sh -s -- 1.2.3
```

The values in `.env` stay, so only `ONCALL_VERSION` changes. The exact
previous `.env` is restored from the backup:

```bash
cp -p ~/oncall/.backup/<date>-<time>/.env ~/oncall/.env
systemctl --user restart oncall
```

Database migrations do not roll back on their own - see
[Update and rollback](wydania.md#update-and-rollback). The
`pre-update-<from>-to-<to>` dump brings back the database as it was before
the update - see [Restoring the database](kopie-zapasowe.md#restoring-the-database).

## Restarting the unit

The `oncall.service` unit runs `deploy/systemd/oncall-stack.sh` from the
deployment directory, so the new stack script is in effect as soon as it is
written. The unit file itself is a copy in `~/.config/systemd/user/`: if the
release changed it, the script overwrites that copy and runs
`systemctl --user daemon-reload`. It refreshes the installed backup units
(`oncall-backup.*`) the same way.

The drop-in `oncall.service.d/checkout.conf` (the directory and any
`ONCALL_COMPOSE_FILES`) stays unchanged. That is why the script does not run
`install-user-unit.sh` again: without arguments it would write the drop-in
afresh and lose the list of skipped overlays.

At the end `systemctl --user restart oncall` does a `down` and then an `up -d`
with the new files and the new `ONCALL_VERSION`. Migrations run at the start
of `api`. The script ends with a list of the containers and their images; the
release number is also shown by the application itself (see [Releases and versions](wydania.md#which-version-runs-on-the-host)).
When the restart fails, the details are in `journalctl --user -u oncall` (when
the user cannot read the journal, see [Verification](kopie-zapasowe.md#verification)).

A migration that moves into the database a rule only the application used to
hold (a date range, say, or no overlapping periods) does not stop the start
over older rows that break it. It writes a `WARNI [alembic.runtime.migration]`
warning to the `api` log naming the rule and the row that breaks it, and the
application runs and holds the rule as before. `podman compose logs api 2>&1 |
grep WARNI`, run in the deployment directory, shows the warnings. Once the rows
are corrected, the SQL command the warning gives finishes the rule.

## A new PostgreSQL major version

A PostgreSQL data directory belongs to the major version that wrote it: the
`postgres:18-alpine` image refuses to start on version 17's data. A release
that moves the `db` service in `docker-compose.yml` to a newer major version
therefore moves the data too, and `update.sh` does it without any extra
command. The first such release moves the database from PostgreSQL 17 to 18.

The script recognises it by the `postgres:<version>` image in the
deployment's and the release's `docker-compose.yml`. Instead of the usual dump
(step 5) it then runs the release's
`deploy/backup/oncall-backup.sh upgrade-postgres`, which:

1. stops `api`, `worker` and `web`, so the dump holds every change;
2. takes the dump `pre-postgres-upgrade-from-17`, proved by a restore like
   every backup, and leaves it in the backup directory;
3. stops the old database and starts the `db` service of the release's
   Compose file on the new `oncall-postgres-18` volume (every major version
   has a volume of its own, named after it);
4. restores the dump into the new database, checks that every table and the
   same schema revision came back, and runs `ANALYZE`, so the planner has
   statistics straight away.

The script pulls the new version's image earlier, with the application
images. It installs the release's files only after a successful move, and the
unit's restart starts `api`, which applies the release's migrations on the new
version. The application is unavailable from the moment `api` stops until the
restart ends; for a database of this size that is a few tens of seconds. The
old `oncall-db` volume is neither written to nor removed.

The new cluster is created with the settings in `docker-compose.yml`
(`POSTGRES_INITDB_ARGS`):

- **page checksums** (`--data-checksums`): a damaged page on disk ends in an
  error instead of silently returned wrong data, which the nightly dump would
  carry into the backups;
- **Polish sorting as the database's collation** (`--locale-provider=icu
  --icu-locale=pl-PL`): every `ORDER BY` on text orders names the way a
  Polish reader expects (`Adam, ala, Ewa, Łukasz, Śliwa, Żaneta`), not by
  character code (`Adam, Ewa, ala, Łukasz, Śliwa, Żaneta`).

Both apply only to a cluster created from scratch: a new deployment and a
database moved to a new version. To check, in the deployment directory
(expected: `on` and `i | pl-PL`):

```bash
podman compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "show data_checksums" \
  -c "select datlocprovider, datlocale from pg_database
      where datname = current_database()"'
```

Once the new version runs well, the old volume can be removed. The script
gives its full name, with the Compose project prefix, e.g.:

```bash
podman volume rm oncall_oncall-db
```

The `pre-postgres-upgrade-from-17` dump stays in the backup directory until
newer backups push it out.

An ICU collation depends on the version of the ICU library in the image. When
an image update changes it, PostgreSQL warns in the `db` log about a collation
version mismatch (`collation version mismatch`). The text indexes are then
rebuilt at a quiet moment, and the new version recorded:

```bash
podman compose exec db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "reindex database" \
  -c "alter database \"$POSTGRES_DB\" refresh collation version"'
```

### When the move fails

An error during the move removes the container and the volume it created, and
`update.sh` restarts the unit: the stack goes back to the previous release and
PostgreSQL 17 on its untouched volume, and no file changes. The script ends
with `moving the database to PostgreSQL 18 failed`, and the cause is printed
above it. Once the cause is removed, running the update again is enough.

If the new database's volume already exists (after a move interrupted by, say,
a killed process, or after going back as described below), the script does
not overwrite it and refuses, giving its name. After checking that it holds
nothing you need, remove it (`podman volume rm <name>`) and run the update
again.

### Going back after a PostgreSQL upgrade

`update.sh` does not move a database to an older major version: a release on
PostgreSQL 17 on a deployment on 18 ends with `does not move a database to an
older major version` and no change. The old release would start on the old
volume with the data from before the update, without everything written since.

When you must go back anyway, knowingly losing the changes since the update,
and the old volume still exists:

1. dump the current state, so it can be recovered;
2. bring back the previous release's `.env` and Compose files from the
   update's backup (in a git checkout: `git checkout --detach v<previous>` and
   `.env` from the same backup);
3. restart the unit - PostgreSQL 17 starts on its old volume.

```bash
cd ~/oncall
./deploy/backup/oncall-backup.sh dump --label before-going-back
cp -p .backup/<date>-<time>/.env .backup/<date>-<time>/docker-compose*.yml .
systemctl --user restart oncall
```

The `oncall-postgres-18` volume stays; remove it before the next update, as
above.

## Older releases

Releases from before the `deploy/systemd/` directory do not have it. In a
plain directory the script then leaves the local unit files alone (`... has no
deploy/systemd/...; keeping the local one`). A git checkout cannot be moved
back before that directory without deleting the script the unit runs, so the
script refuses and changes nothing.
