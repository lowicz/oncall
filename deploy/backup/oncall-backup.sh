#!/usr/bin/env bash
# shellcheck disable=SC2016 # $POSTGRES_* in single quotes is the container's own environment
# Database backups for the On-call Podman deployment.
#
# A backup is a logical pg_dump taken inside the running db container (the
# server's own pg_dump, over its local socket, no password and no port), then
# proved by a full restore into a throwaway container of the same image, and
# only then kept. The newest ONCALL_BACKUP_KEEP backups stay; older ones go.
# Guide: docs/wdrozenie/kopie-zapasowe.md. deploy/backup/setup.sh installs the
# daily timer; deploy/update.sh runs `dump` before it restarts the stack.
#
# Settings come from the environment, then from the file setup.sh writes
# (${XDG_CONFIG_HOME:-~/.config}/oncall/backup.conf, KEY=value lines, never
# sourced), then from the defaults below. This script does not read .env.
#
# Everything this script starts is labelled with VERIFY_LABEL and removed on
# exit, pass or fail; a run killed before its trap could fire is swept by the
# next run (or `cleanup`), which removes only containers carrying that label.
set -euo pipefail

usage() {
  cat <<'EOF'
usage: oncall-backup.sh [--dir DEPLOY_DIR] COMMAND

  dump [--label LABEL]  take a backup, prove it restores, keep it, drop the oldest
  verify FILE           restore FILE into a throwaway container and check it
  restore FILE [--yes]  replace the database with FILE (stops api, worker and web)
  list                  the backups, newest first
  status                settings, the last success and the last failure
  check                 check settings, the backup directory and the stack
  prune                 keep only the newest ONCALL_BACKUP_KEEP backups
  cleanup               remove what an interrupted run left behind
  alert [--test]        e-mail the last failure (or a test) via the app's SMTP
  admin-emails          print the e-mail addresses of active administrators

DEPLOY_DIR is the deployment checkout (compose files and .env); by default
the checkout this script is in. Settings: ONCALL_BACKUP_DIR,
ONCALL_BACKUP_KEEP, ONCALL_BACKUP_OWNER, ONCALL_BACKUP_ALERT_EMAIL,
ONCALL_BACKUP_TIME (the timer's, set by setup.sh), ONCALL_BACKUP_WAIT_SECONDS
(docs/wdrozenie/kopie-zapasowe.md).
EOF
}

readonly SETTINGS=(ONCALL_BACKUP_DIR ONCALL_BACKUP_KEEP ONCALL_BACKUP_OWNER
  ONCALL_BACKUP_ALERT_EMAIL ONCALL_BACKUP_TIME ONCALL_BACKUP_WAIT_SECONDS)
readonly VERIFY_LABEL=io.github.lowicz.oncall.backup-verify
readonly NAME_RE='^oncall-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9._-]+\.dump$'

step=preflight
label=manual
state_dir=""
lock_fd=""
errfile=""
verify_containers=()
verified_revision=""
stopped_services=()
failure_recorded=false
record_failures=false
marked_running=false
configured=false

say() {
  printf '%s\n' "$*"
}

warn() {
  printf 'warning: %s\n' "$*" >&2
}

# Stops the run. In a dump, the message is also what the failure alert sends.
die() {
  printf 'error: %s\n' "$*" >&2
  record_failure "$*"
  exit 1
}

write_failure() { # step label details
  local tmp=$state_dir/.last-failure.$$
  if {
    printf 'time=%s\n' "$(date -Iseconds)"
    printf 'step=%s\n' "$1"
    printf 'label=%s\n' "$2"
    printf '\n%s\n' "$3"
  } >"$tmp" 2>/dev/null; then
    mv -f "$tmp" "$state_dir/last-failure" 2>/dev/null || true
  fi
}

record_failure() {
  [ "$record_failures" = true ] && [ "$failure_recorded" = false ] && [ -n "$state_dir" ] || return 0
  failure_recorded=true
  write_failure "$step" "$label" "$*"
}

# A dump keeps $state_dir/running, with its label and step, while it works,
# and its own exit removes it. Found under the lock, it means a dump was killed
# before it could record why (SIGKILL, a unit timeout): sweep records that,
# as the unit's ExecStopPost before OnFailure= sends the alert, or at the next
# run.
enter_step() {
  step=$1
  [ "$record_failures" = true ] || return 0
  printf 'step=%s\nlabel=%s\n' "$step" "$label" >"$state_dir/.running.$$" &&
    mv -f "$state_dir/.running.$$" "$state_dir/running"
  marked_running=true
}

# Runs a command with its stderr kept, so a failure can say what went wrong.
# Stdout stays the command's own (redirect it at the call site).
capture() {
  local what=$1
  shift
  if ! "$@" 2>"$errfile"; then
    die "$what failed: $(tail -n 15 "$errfile")"
  fi
  if [ -s "$errfile" ]; then
    cat "$errfile" >&2
  fi
}

on_exit() {
  local status=$?
  trap - EXIT
  set +e
  if [ "$status" -ne 0 ]; then
    record_failure "failed during $step (exit $status)"
  fi
  if [ "$marked_running" = true ]; then
    rm -f "$state_dir/running" "$state_dir/.running.$$"
  fi
  local name
  for name in "${verify_containers[@]}"; do
    podman rm --force --volumes --time 0 "$name" >/dev/null 2>&1
  done
  if [ "${#stopped_services[@]}" -gt 0 ]; then
    warn "starting api, worker and web again"
    start_services "${stopped_services[@]}" >/dev/null 2>&1 || warn "could not start all of ${stopped_services[*]}"
  fi
  if [ -n "${backup_dir:-}" ] && [ -n "${tmp_dump:-}" ]; then
    rm -f "$tmp_dump"
  fi
  if [ -n "$errfile" ]; then
    rm -f "$errfile"
  fi
  exit "$status"
}

# Every Podman call closes the lock: `podman start` and `podman run` leave a
# conmon process behind per container, and an inherited lock descriptor would
# keep the lock held for as long as that container runs.
podman() {
  if [ -n "$lock_fd" ]; then
    command podman "$@" {lock_fd}>&-
  else
    command podman "$@"
  fi
}

need_cmd() {
  local cmd
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || die "$cmd not found"
  done
}

# --- settings -------------------------------------------------------------

load_settings() {
  local config=${ONCALL_BACKUP_CONFIG:-${XDG_CONFIG_HOME:-$HOME/.config}/oncall/backup.conf}
  local -A from_env=()
  local key line value
  for key in "${SETTINGS[@]}"; do
    if [ -n "${!key+x}" ]; then
      from_env[$key]=1
    fi
  done
  configured=false
  if [ -f "$config" ]; then
    configured=true
    while IFS= read -r line || [ -n "$line" ]; do
      case $line in
        '' | '#'*) continue ;;
      esac
      key=${line%%=*}
      value=${line#*=}
      case " ${SETTINGS[*]} " in
        *" $key "*) ;;
        *) die "$config: unknown setting: $line" ;;
      esac
      if [ -z "${from_env[$key]:-}" ]; then
        printf -v "$key" '%s' "$value"
      fi
    done <"$config"
  fi
  backup_dir=${ONCALL_BACKUP_DIR:-$HOME/oncall-backups}
  keep=${ONCALL_BACKUP_KEEP:-30}
  owner=${ONCALL_BACKUP_OWNER:-$(id -un)}
  alert_email=${ONCALL_BACKUP_ALERT_EMAIL:-}
  backup_time=${ONCALL_BACKUP_TIME:-21:00}
  wait_seconds=${ONCALL_BACKUP_WAIT_SECONDS:-600}
  case $backup_dir in
    /*) ;;
    *) die "ONCALL_BACKUP_DIR must be an absolute path: $backup_dir" ;;
  esac
  case $keep in
    '' | *[!0-9]* | 0*) die "ONCALL_BACKUP_KEEP must be a whole number of at least 1: $keep" ;;
  esac
  case $wait_seconds in
    '' | *[!0-9]*) die "ONCALL_BACKUP_WAIT_SECONDS must be a whole number: $wait_seconds" ;;
  esac
  state_dir=${XDG_STATE_HOME:-$HOME/.local/state}/oncall-backup
}

# The backups belong to one user: the one whose systemd runs oncall.service
# and whose rootless Podman owns the containers. Nobody else runs this.
check_owner() {
  [ "$(id -u)" -ne 0 ] || die "run as the deployment user ($owner), not root: rootless Podman keeps the containers per user"
  [ "$(id -un)" = "$owner" ] ||
    die "backups belong to $owner (ONCALL_BACKUP_OWNER); run this as $owner, not $(id -un)"
}

# The directory must exist, belong to the owner and be closed to everyone else.
check_backup_dir() {
  [ -d "$backup_dir" ] ||
    die "$backup_dir does not exist; create it with deploy/backup/setup.sh (or mkdir -m 700 $backup_dir)"
  local dir_owner dir_mode
  dir_owner=$(stat -c %u "$backup_dir")
  dir_mode=$(stat -c %a "$backup_dir")
  [ "$dir_owner" = "$(id -u)" ] ||
    die "$backup_dir belongs to uid $dir_owner, not to $owner; fix it with: sudo chown $owner: $backup_dir"
  case $dir_mode in
    700 | 1700) ;;
    *) die "$backup_dir is mode $dir_mode; backups hold personal data, close it with: chmod 700 $backup_dir" ;;
  esac
  [ -w "$backup_dir" ] || die "$backup_dir is not writable"
}

ensure_state_dir() {
  mkdir -p "$state_dir"
  chmod 700 "$state_dir"
}

# One run at a time per user: the timer, update.sh and a manual run share it.
take_lock() {
  ensure_state_dir
  exec {lock_fd}>"$state_dir/lock"
  flock -w 900 "$lock_fd" || die "another backup run still holds $state_dir/lock after 15 minutes"
}

# --- the stack --------------------------------------------------------------

resolve_deploy_dir() {
  local dir=$1
  [ -d "$dir" ] || die "not a directory: $dir"
  deploy_dir=$(cd "$dir" && pwd -P)
  [ -f "$deploy_dir/docker-compose.yml" ] || die "$deploy_dir has no docker-compose.yml; pass the deployment directory with --dir"
}

# Compose labels every container with its project directory and service,
# whichever provider `podman compose` runs (docker-compose or podman-compose),
# so the container is found by label and never by its provider-specific name.
find_service() {
  local service=$1 ids project
  ids=$(podman ps --all --no-trunc --format '{{.ID}}' \
    --filter "label=com.docker.compose.project.working_dir=$deploy_dir" \
    --filter "label=com.docker.compose.service=$service")
  if [ -z "$ids" ]; then
    project=$(basename "$deploy_dir" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-')
    ids=$(podman ps --all --no-trunc --format '{{.ID}}' \
      --filter "label=com.docker.compose.project=$project" \
      --filter "label=com.docker.compose.service=$service")
  fi
  case $ids in
    '') return 1 ;;
    *$'\n'*) die "more than one $service container belongs to $deploy_dir: $(printf '%s' "$ids" | tr '\n' ' ')" ;;
  esac
  printf '%s\n' "$ids"
}

# One field of a container, read from `podman ps`: Podman 5.8 warns on every
# `podman inspect` of a Compose container with a tmpfs mount ("Could not find
# mount at destination"), which would fill the output and the journal.
container_field() {
  podman ps --all --no-trunc --filter "id=$1" --format "$2"
}

# Starts containers one by one in the order given. restore passes web last:
# nginx resolves api once, when it starts, and a restarted api container can
# come back with another address.
start_services() { # id...
  local id status=0
  for id in "$@"; do
    podman start "$id" >/dev/null || status=1
  done
  return "$status"
}

is_running() {
  [ "$(container_field "$1" '{{.State}}' 2>/dev/null)" = running ]
}

# The db container, running and accepting connections. At boot the timer can
# fire before the stack is up, so this waits up to ONCALL_BACKUP_WAIT_SECONDS.
wait_for_db() {
  local waited=0
  while :; do
    if db_id=$(find_service db) && is_running "$db_id" &&
      podman exec "$db_id" sh -c 'pg_isready -q -h 127.0.0.1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
      return 0
    fi
    if [ "$waited" -ge "$wait_seconds" ]; then
      if [ -z "${db_id:-}" ]; then
        die "no db container of $deploy_dir (is the stack up? systemctl --user status oncall)"
      fi
      die "the db container of $deploy_dir is not running or not ready after ${wait_seconds}s (systemctl --user status oncall)"
    fi
    if [ "$waited" -eq 0 ]; then
      say "Waiting up to ${wait_seconds}s for the database of $deploy_dir"
    fi
    sleep 5
    waited=$((waited + 5))
  done
}

db_env() {
  podman exec "$db_id" printenv "$1"
}

# psql inside the db container, as the database's own user; SQL on stdin.
db_psql() {
  local database=${1:-}
  podman exec -i "$db_id" sh -c 'exec psql -X -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "${1:-$POSTGRES_DB}"' sh "$database"
}

schema_revision() {
  db_psql <<<'select version_num from alembic_version' 2>/dev/null | head -n 1
}

table_list() { # container ; the public tables, one per line, in byte order
  podman exec -i "$1" sh -c 'exec psql -X -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
    <<<"select tablename from pg_tables where schemaname = 'public' order by tablename collate \"C\""
}

# The public tables FILE's own table of contents lists, like table_list.
archive_table_list() { # container file
  podman exec -i "$1" pg_restore --list <"$2" |
    awk '$4 == "TABLE" && $5 == "public" { print $6 }' | LC_ALL=C sort
}

# "missing [a, b]; unexpected [c]" between two table_list outputs.
table_difference() { # expected restored
  local missing unexpected
  missing=$(LC_ALL=C comm -23 <(printf '%s\n' "$1") <(printf '%s\n' "$2") | paste -sd, - | sed 's/,/, /g')
  unexpected=$(LC_ALL=C comm -13 <(printf '%s\n' "$1") <(printf '%s\n' "$2") | paste -sd, - | sed 's/,/, /g')
  printf 'missing [%s], unexpected [%s]' "$missing" "$unexpected"
}

# --- dump, verify, keep -------------------------------------------------------

# Restores FILE into a throwaway container of the running db's own image: no
# network, read-only, every declared volume on tmpfs (so no volume is ever
# created), removed on exit whatever happens. Checks that every table came
# back: for a fresh dump (`live REVISION`) every table of the live database and
# its schema revision; for a kept backup (`archive`) every table its own table
# of contents lists, since the live schema may have moved on since.
verify_file() { # file live REVISION | file archive
  local file=$1 mode=$2 expected_revision=${3:-} image name user database password volumes path
  local -a mounts=()
  image=$(container_field "$db_id" '{{.ImageID}}')
  user=$(db_env POSTGRES_USER)
  database=$(db_env POSTGRES_DB)
  volumes=$(podman image inspect --format '{{range $path, $_ := .Config.Volumes}}{{$path}} {{end}}' "$image")
  local pgdata covered=false
  pgdata=$(db_env PGDATA)
  for path in $volumes; do
    mounts+=(--tmpfs "$path")
    case $pgdata/ in
      "${path%/}"/*) covered=true ;;
    esac
  done
  if [ "$covered" = false ]; then
    mounts+=(--tmpfs "$pgdata")
  fi
  password=$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')
  name=oncall-backup-verify-$$-$RANDOM
  verify_containers+=("$name")
  capture "starting the restore-test container" podman run --detach --name "$name" \
    --label "$VERIFY_LABEL=$deploy_dir" --pull never --network none --read-only \
    --tmpfs /var/run/postgresql --tmpfs /tmp "${mounts[@]}" \
    --cap-drop ALL --cap-add CHOWN --cap-add DAC_READ_SEARCH --cap-add FOWNER \
    --cap-add SETGID --cap-add SETUID --security-opt no-new-privileges \
    --env "POSTGRES_USER=$user" --env "POSTGRES_DB=$database" --env "POSTGRES_PASSWORD=$password" \
    "$image" >/dev/null
  # The image's first start runs a socket-only server to initialise the data
  # directory; only the real server listens on TCP, so readiness is asked there.
  local waited=0
  until podman exec "$name" pg_isready -q -h 127.0.0.1 -U "$user" -d "$database" >/dev/null 2>&1; do
    if [ -z "$(podman ps --quiet --filter "name=^$name\$" --filter status=running)" ]; then
      die "the restore-test container stopped: $(podman logs --tail 10 "$name" 2>&1)"
    fi
    if [ "$waited" -ge 120 ]; then
      die "the restore-test container was not ready after 120s: $(podman logs --tail 10 "$name" 2>&1)"
    fi
    sleep 1
    waited=$((waited + 1))
  done
  # shellcheck disable=SC2094 # reads $file; capture writes only its own error file
  capture "restoring $(basename "$file") in the restore-test container" \
    podman exec -i "$name" pg_restore -U "$user" -d "$database" --exit-on-error --single-transaction <"$file"
  local expected restored revision
  restored=$(table_list "$name")
  [ -n "$restored" ] || die "$(basename "$file") restored no table"
  if [ "$mode" = live ]; then
    expected=$(table_list "$db_id")
    [ "$restored" = "$expected" ] ||
      die "$(basename "$file") did not restore the tables of the database: $(table_difference "$expected" "$restored")"
  else
    expected=$(archive_table_list "$name" "$file")
    [ "$restored" = "$expected" ] ||
      die "$(basename "$file") did not restore the tables it lists: $(table_difference "$expected" "$restored")"
  fi
  revision=$(podman exec -i "$name" sh -c 'exec psql -X -q -At -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
    <<<'select version_num from alembic_version' 2>/dev/null | head -n 1) || true
  verified_revision=$revision
  if [ "$mode" = live ] && [ "$revision" != "$expected_revision" ]; then
    die "$(basename "$file") has schema revision '$revision', the database had '$expected_revision'"
  fi
  podman rm --force --volumes --time 0 "$name" >/dev/null 2>&1 || true
}

# Leftovers of runs that were killed before their own trap ran: restore-test
# containers of this deployment (by label, nothing else) and unfinished files.
sweep() {
  local ids killed_step killed_label systemd_result=""
  if [ -f "$state_dir/running" ]; then
    killed_step=$(sed -n 's/^step=//p' "$state_dir/running")
    killed_label=$(sed -n 's/^label=//p' "$state_dir/running")
    if [ -n "${SERVICE_RESULT:-}" ]; then
      systemd_result=" (systemd: result=$SERVICE_RESULT code=${EXIT_CODE:-} status=${EXIT_STATUS:-})"
    fi
    write_failure "$killed_step" "$killed_label" \
      "the backup was stopped during $killed_step before it could finish$systemd_result"
    rm -f "$state_dir/running"
    say "Recorded the backup stopped during $killed_step as failed"
  fi
  ids=$(podman ps --all --format '{{.ID}}' --filter "label=$VERIFY_LABEL=$deploy_dir")
  if [ -n "$ids" ]; then
    # shellcheck disable=SC2086 # one ID per word
    podman rm --force --volumes --time 0 $ids >/dev/null
    say "Removed $(printf '%s\n' "$ids" | wc -l | tr -d ' ') restore-test container(s) left by an interrupted run"
  fi
  if [ -d "$backup_dir" ]; then
    find "$backup_dir" -maxdepth 1 -type f -name '.tmp.oncall-*' -delete
  fi
}

backups_oldest_first() {
  local file
  for file in "$backup_dir"/oncall-*.dump; do
    [ -f "$file" ] || continue
    [[ $(basename "$file") =~ $NAME_RE ]] && printf '%s\n' "$file"
  done
}

prune() {
  enter_step prune
  local -a files=()
  mapfile -t files < <(backups_oldest_first)
  local excess=$((${#files[@]} - keep)) i
  for ((i = 0; i < excess; i++)); do
    rm -f "${files[$i]}"
    say "Removed $(basename "${files[$i]}")"
  done
}

write_last_success() {
  local file=$1 tmp=$state_dir/.last-success.$$
  {
    printf 'time=%s\n' "$(date -Iseconds)"
    printf 'file=%s\n' "$file"
    printf 'size=%s\n' "$(stat -c %s "$file")"
    printf 'sha256=%s\n' "$(sha256sum "$file" | cut -d' ' -f1)"
    printf 'label=%s\n' "$label"
  } >"$tmp"
  mv -f "$tmp" "$state_dir/last-success"
}

do_dump() {
  step=preflight
  # Before deploy/backup/setup.sh has run there are no settings: the dump
  # update.sh takes before the first update to a release with backups goes to
  # the default directory, created here, instead of stopping the update. Once
  # set up, a missing directory is an error (e.g. a disk that did not mount).
  if [ "$configured" = false ] && [ ! -e "$backup_dir" ]; then
    mkdir -p -- "$backup_dir"
    chmod 700 "$backup_dir"
    say "Created $backup_dir; deploy/backup/setup.sh sets up the daily backups"
  fi
  check_backup_dir
  sweep
  enter_step preflight
  wait_for_db
  local revision stamp final
  revision=$(schema_revision) || true
  [ -n "$revision" ] || die "the database has no alembic_version; is this the On-call database?"
  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  final=$backup_dir/oncall-$stamp-$label-$(printf '%s' "$revision" | tr -c 'A-Za-z0-9._-' '_').dump
  tmp_dump=$backup_dir/.tmp.$(basename "$final")

  enter_step dump
  say "Dumping the database of $deploy_dir"
  (umask 077 && : >"$tmp_dump")
  capture "pg_dump" podman exec "$db_id" \
    sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=zstd' >"$tmp_dump"
  [ -s "$tmp_dump" ] || die "pg_dump wrote nothing"

  enter_step verify
  say "Restoring it into a throwaway container"
  verify_file "$tmp_dump" live "$revision"

  enter_step save
  sync "$tmp_dump"
  mv "$tmp_dump" "$final"
  tmp_dump=""
  sync "$backup_dir"
  write_last_success "$final"
  say "Backup: $final ($(du -h "$final" | cut -f1))"
  prune
  step="done"
}

# --- restore ------------------------------------------------------------------

# Replaces the database with FILE. The file is restored into a new database
# first and swapped in by renaming, so a file that does not restore leaves the
# live database untouched. api, worker and web are stopped for the swap and
# always started again, web last. A backup of the current state is taken first.
do_restore() {
  local file=$1 confirmed=$2
  [ -f "$file" ] || die "no such file: $file"
  file=$(cd "$(dirname "$file")" && pwd -P)/$(basename "$file")
  check_backup_dir
  wait_for_db
  if [ "$confirmed" != true ]; then
    [ -t 0 ] || die "restore replaces the database; pass --yes to confirm when not on a terminal"
    printf 'Replace the database of %s with %s? The current state is backed up first. [y/N] ' \
      "$deploy_dir" "$(basename "$file")"
    local answer
    read -r answer
    case $answer in
      y | Y | yes) ;;
      *) die "not confirmed; nothing was changed" ;;
    esac
  fi
  say "Checking that $(basename "$file") restores"
  verify_file "$file" archive

  label=pre-restore
  do_dump
  local safety
  safety=$(sed -n 's/^file=//p' "$state_dir/last-success")

  local database user side old service id live_revision
  database=$(db_env POSTGRES_DB)
  user=$(db_env POSTGRES_USER)
  [[ $database =~ ^[A-Za-z0-9_]+$ && $user =~ ^[A-Za-z0-9_]+$ ]] ||
    die "restore handles only plain database and user names, not '$database' and '$user'"
  # Fixed names: whatever a killed restore left behind, the next one drops.
  side=${database}_restore
  old=${database}_before_restore
  live_revision=$(schema_revision) || true

  step=restore
  for service in api worker web; do
    if id=$(find_service "$service") && is_running "$id"; then
      stopped_services+=("$id")
    fi
  done
  if [ "${#stopped_services[@]}" -gt 0 ]; then
    say "Stopping api, worker and web"
    capture "stopping api, worker and web" podman stop "${stopped_services[@]}" >/dev/null
  fi
  capture "preparing the database $side" db_psql postgres >/dev/null <<SQL
set client_min_messages = warning;
drop database if exists "$side";
drop database if exists "$old";
create database "$side" owner "$user";
SQL
  say "Restoring $(basename "$file")"
  if ! podman exec -i "$db_id" sh -c 'exec pg_restore -U "$POSTGRES_USER" -d "$1" --exit-on-error --single-transaction' sh "$side" \
    <"$file" 2>"$errfile"; then
    db_psql postgres <<<"set client_min_messages = warning; drop database if exists \"$side\"" || true
    die "restoring $(basename "$file") failed, the database is unchanged: $(tail -n 15 "$errfile")"
  fi
  capture "swapping in the restored database" db_psql postgres >/dev/null <<SQL
select pg_terminate_backend(pid) from pg_stat_activity where datname in ('$database', '$side') and pid <> pg_backend_pid();
begin;
alter database "$database" rename to "$old";
alter database "$side" rename to "$database";
commit;
SQL
  capture "dropping the replaced database" db_psql postgres <<<"drop database \"$old\""
  if [ "${#stopped_services[@]}" -gt 0 ]; then
    say "Starting api, worker and web"
    capture "starting api, worker and web" start_services "${stopped_services[@]}"
    stopped_services=()
  fi
  step="done"
  say "Restored $(basename "$file"). The state before the restore: $safety"
  if [ "$verified_revision" != "$live_revision" ]; then
    say "The backup has schema revision $verified_revision; the database had $live_revision."
    say "api migrates an older schema as it starts; a newer one needs the release that wrote it."
  fi
}

# --- alerts -------------------------------------------------------------------

alert_container() {
  local service id
  for service in api worker; do
    if id=$(find_service "$service") && is_running "$id"; then
      printf '%s\n' "$id"
      return 0
    fi
  done
  return 1
}

do_alert() {
  local test=$1 container failed_at alert_step details recipient
  local -a to=()
  for recipient in ${alert_email//,/ }; do
    to+=(--to "$recipient")
  done
  [ "${#to[@]}" -gt 0 ] || die "no alert recipient: set ONCALL_BACKUP_ALERT_EMAIL (deploy/backup/setup.sh --alert-email)"
  container=$(alert_container) || die "neither api nor worker of $deploy_dir is running; the alert cannot use the application's SMTP settings"
  if [ "$test" = true ]; then
    failed_at=$(date -Iseconds)
    alert_step="test"
    details=""
  else
    [ -f "$state_dir/last-failure" ] || die "no failure recorded in $state_dir/last-failure"
    failed_at=$(sed -n 's/^time=//p' "$state_dir/last-failure" | head -n 1)
    alert_step=$(sed -n 's/^step=//p' "$state_dir/last-failure" | head -n 1)
    details=$(sed '1,/^$/d' "$state_dir/last-failure")
  fi
  local -a args=("${to[@]}" --host "$(uname -n)" --step "${alert_step:-dump}" --failed-at "$failed_at")
  if [ "$test" = true ]; then
    args+=(--test)
  fi
  printf '%s\n' "$details" | podman exec -i "$container" python -m oncall.backup_alert "${args[@]}"
}

# --- small commands -------------------------------------------------------------

do_list() {
  local -a files=()
  mapfile -t files < <(backups_oldest_first)
  if [ "${#files[@]}" -eq 0 ]; then
    say "No backups in $backup_dir"
    return 0
  fi
  local i
  for ((i = ${#files[@]} - 1; i >= 0; i--)); do
    printf '%s\t%s\n' "$(du -h "${files[$i]}" | cut -f1)" "$(basename "${files[$i]}")"
  done
}

# Whether oncall-backup.timer is installed and running, and when it fires.
timer_summary() {
  local shown key value load="" active="" next="" last=""
  if ! command -v systemctl >/dev/null 2>&1 ||
    ! shown=$(systemctl --user show oncall-backup.timer \
      --property=LoadState,ActiveState,NextElapseUSecRealtime,LastTriggerUSec 2>/dev/null); then
    printf 'unknown: the systemd user manager is not reachable'
    return 0
  fi
  while IFS='=' read -r key value; do
    case $key in
      LoadState) load=$value ;;
      ActiveState) active=$value ;;
      NextElapseUSecRealtime) next=$value ;;
      LastTriggerUSec) last=$value ;;
    esac
  done <<<"$shown"
  case $last in '' | n/a) last=never ;; esac
  if [ "$load" != loaded ]; then
    printf 'not installed (deploy/backup/setup.sh installs it)'
  elif [ "$active" != active ]; then
    printf '%s (systemctl --user enable --now oncall-backup.timer)' "$active"
  else
    printf 'next %s, last %s' "${next:-unknown}" "$last"
  fi
}

do_status() {
  say "Deployment:  $deploy_dir"
  say "Owner:       $owner"
  say "Directory:   $backup_dir"
  say "Keep:        $keep newest"
  say "Time:        $backup_time daily, up to 15 minutes later"
  say "Alerts to:   ${alert_email:-(nobody: set ONCALL_BACKUP_ALERT_EMAIL)}"
  say "Timer:       $(timer_summary)"
  say "Backups:     $(backups_oldest_first | wc -l | tr -d ' ')"
  if [ -f "$state_dir/last-success" ]; then
    say "Last success:"
    sed 's/^./  &/' "$state_dir/last-success"
  else
    say "Last success: none yet"
  fi
  if [ -f "$state_dir/last-failure" ]; then
    say "Last failure:"
    sed 's/^./  &/' "$state_dir/last-failure"
  fi
}

do_check() {
  check_backup_dir
  wait_seconds=0
  wait_for_db
  say "db: $(container_field "$db_id" '{{.Names}}') is running, schema $(schema_revision)"
  local container smtp
  if container=$(alert_container); then
    smtp=$(podman exec "$container" printenv ONCALL_SMTP_HOST 2>/dev/null || true)
    if [ -n "$smtp" ]; then
      say "alerts: sent through $smtp by $(container_field "$container" '{{.Names}}')"
    else
      warn "the application has no SMTP server (ONCALL_SMTP_HOST in .env): failure alerts cannot be sent"
    fi
  else
    warn "neither api nor worker is running: failure alerts cannot be sent until one is"
  fi
  [ -n "$alert_email" ] || warn "no alert recipient (ONCALL_BACKUP_ALERT_EMAIL)"
  say "Backups of $deploy_dir go to $backup_dir (owner $owner, keep $keep)"
}

do_admin_emails() {
  wait_seconds=0
  wait_for_db
  db_psql <<<"select email from users where role = 'admin' and is_active and coalesce(email, '') <> '' order by username"
}

# --- main ---------------------------------------------------------------------

main() {
  local dir=""
  while [ "$#" -gt 0 ]; do
    case $1 in
      -h | --help)
        usage
        return 0
        ;;
      --dir)
        [ "$#" -ge 2 ] || die "--dir needs a directory"
        dir=$2
        shift 2
        ;;
      --dir=*)
        dir=${1#--dir=}
        shift
        ;;
      *) break ;;
    esac
  done
  [ "$#" -ge 1 ] || {
    usage >&2
    return 2
  }
  local command=$1
  shift
  if [ -z "$dir" ]; then
    dir=$(dirname "${BASH_SOURCE[0]}")/../..
  fi

  errfile=$(mktemp)
  trap on_exit EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP
  need_cmd podman flock stat sha256sum
  load_settings
  check_owner
  resolve_deploy_dir "$dir"

  case $command in
    dump)
      while [ "$#" -gt 0 ]; do
        case $1 in
          --label)
            [ "$#" -ge 2 ] || die "--label needs a value"
            label=$(printf '%s' "$2" | tr -c 'A-Za-z0-9._-' '_')
            shift 2
            ;;
          *) die "unknown dump option: $1" ;;
        esac
      done
      ensure_state_dir
      record_failures=true
      take_lock
      do_dump
      ;;
    verify)
      [ "$#" -eq 1 ] || die "usage: verify FILE"
      [ -f "$1" ] || die "no such file: $1"
      take_lock
      wait_seconds=0
      wait_for_db
      step=verify
      verify_file "$1" archive
      say "$(basename "$1") restores: every table it holds came back"
      ;;
    restore)
      local file="" confirmed=false
      while [ "$#" -gt 0 ]; do
        case $1 in
          --yes) confirmed=true ;;
          -*) die "unknown restore option: $1" ;;
          *) file=$1 ;;
        esac
        shift
      done
      [ -n "$file" ] || die "usage: restore FILE [--yes]"
      take_lock
      wait_seconds=0
      do_restore "$file" "$confirmed"
      ;;
    list) do_list ;;
    status) do_status ;;
    check) do_check ;;
    prune)
      check_backup_dir
      take_lock
      prune
      ;;
    cleanup)
      take_lock
      sweep
      ;;
    alert)
      case ${1:-} in
        --test) do_alert true ;;
        '') do_alert false ;;
        *) die "unknown alert option: $1" ;;
      esac
      ;;
    admin-emails) do_admin_emails ;;
    *)
      usage >&2
      return 2
      ;;
  esac
}

main "$@"
