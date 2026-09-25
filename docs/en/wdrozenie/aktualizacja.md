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
   the `deploy/systemd/` files. When the directory is a git checkout, it does
   `git fetch --tags` and a `git checkout` of the tag instead.
3. Builds the new `.env` - see [below](#how-env-changes).
4. Pulls the `ghcr.io/lowicz/oncall-api` and `ghcr.io/lowicz/oncall-web`
   images in that version. If the release does not exist, the script stops
   here and changes nothing; nor does the restart later wait for the pull.
5. Makes a [backup](#backup-and-rollback) of every file it will change and
   writes the new files. A file identical to the release's is left untouched.
6. Restarts the unit - see [Restarting the unit](#restarting-the-unit).

The script does not touch the `tls/` directory, the unit's drop-in or the
volumes. Running it again with the same number changes no file and only
restarts the unit.

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

A rollback is the same script with the previous number. The script prints it
at the beginning of every run (`On-call in ~/oncall: 1.2.3 -> 1.2.4`) and also
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
[Update and rollback](wydania.md#update-and-rollback).

## Restarting the unit

The `oncall.service` unit runs `deploy/systemd/oncall-stack.sh` from the
deployment directory, so the new stack script is in effect as soon as it is
written. The unit file itself is a copy in `~/.config/systemd/user/`: if the
release changed it, the script overwrites that copy and runs
`systemctl --user daemon-reload`.

The drop-in `oncall.service.d/checkout.conf` (the directory and any
`ONCALL_COMPOSE_FILES`) stays unchanged. That is why the script does not run
`install-user-unit.sh` again: without arguments it would write the drop-in
afresh and lose the list of skipped overlays.

At the end `systemctl --user restart oncall` does a `down` and then an `up -d`
with the new files and the new `ONCALL_VERSION`. Migrations run at the start
of `api`. The script ends with a list of the containers and their images; the
release number is also shown by the application itself (see [Releases and versions](wydania.md#which-version-runs-on-the-host)).
When the restart fails, the details are in `journalctl --user -u oncall`.

## Older releases

Releases from before the `deploy/systemd/` directory do not have it. In a
plain directory the script then leaves the local unit files alone (`... has no
deploy/systemd/...; keeping the local one`). A git checkout cannot be moved
back before that directory without deleting the script the unit runs, so the
script refuses and changes nothing.
