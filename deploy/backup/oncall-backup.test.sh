#!/usr/bin/env bash
# Tests for deploy/backup/oncall-backup.sh against real rootless Podman: a
# PostgreSQL container started with the db service's Compose hardening and
# labels, and api/worker stand-ins whose `python` records the alert it was
# asked to send, plus a web stand-in. What the script writes lives in a
# temporary directory, removed at exit with every container and volume the
# test made.
#
#   bash deploy/backup/oncall-backup.test.sh
set -u
# The caller's own settings must not leak into the runs.
unset ONCALL_BACKUP_CONFIG ONCALL_BACKUP_DIR ONCALL_BACKUP_KEEP ONCALL_BACKUP_OWNER \
  ONCALL_BACKUP_ALERT_EMAIL ONCALL_BACKUP_WAIT_SECONDS

repo_root=$(cd "$(dirname "$0")/../.." && pwd -P)
script=$repo_root/deploy/backup/oncall-backup.sh
image=${ONCALL_BACKUP_TEST_IMAGE:-docker.io/library/postgres:17-alpine}
work=$(mktemp -d)
run_id=oncall-backup-test-$$
failures=0
current_test=""

cleanup() {
  local ids
  ids=$(podman ps --all --quiet --filter "label=$run_id")
  ids+=" $(podman ps --all --quiet --filter "label=io.github.lowicz.oncall.backup-verify=$deploy")"
  # shellcheck disable=SC2086 # one ID per word
  podman rm --force --volumes --time 0 $ids >/dev/null 2>&1
  podman volume rm --force "$run_id-data" >/dev/null 2>&1
  rm -rf "$work"
}
trap cleanup EXIT

fail() {
  printf 'FAIL %s: %s\n' "$current_test" "$*" >&2
  failures=$((failures + 1))
}

check() {
  current_test=$1
  printf -- '- %s\n' "$1"
}

has_text() {
  grep -Fq -- "$2" "$1" || fail "$1 lacks: $2 ($(tail -n 5 "$1"))"
}

lacks_text() {
  if grep -Fq -- "$2" "$1"; then
    fail "$1 has: $2"
  fi
}

mode_of() {
  stat -c %a "$1"
}

deploy=$work/deploy
home=$work/home
backups=$work/backups
mkdir -p "$deploy" "$home" "$work/alert"
cp "$repo_root/docker-compose.yml" "$deploy/"
deploy=$(cd "$deploy" && pwd -P)

# `python -m oncall.backup_alert ...` inside the stand-ins: record and succeed.
cat >"$work/python" <<'EOF'
#!/bin/sh
printf '%s\n' "$@" >/alert/args
cat >/alert/stdin
echo "backup alert sent"
EOF
chmod 755 "$work/python"
chmod 777 "$work/alert"

podman image exists "$image" || podman pull --quiet "$image" >/dev/null || {
  echo "cannot pull $image" >&2
  exit 1
}

labels() { # service
  printf -- '--label\n%s\n' "$run_id" "com.docker.compose.project=deploy" \
    "com.docker.compose.project.working_dir=$deploy" "com.docker.compose.service=$1"
}

start_db() {
  mapfile -t label_args < <(labels db)
  podman run --detach --name "$run_id-db" "${label_args[@]}" \
    --security-opt no-new-privileges:true --read-only --tmpfs /var/run/postgresql --tmpfs /tmp \
    --cap-drop ALL --cap-add CHOWN --cap-add DAC_READ_SEARCH --cap-add FOWNER --cap-add SETGID --cap-add SETUID \
    --env POSTGRES_DB=oncall --env POSTGRES_USER=oncall --env POSTGRES_PASSWORD=test \
    --volume "$run_id-data:/var/lib/postgresql/data" "$image" >/dev/null
  local waited=0
  until podman exec "$run_id-db" pg_isready -q -h 127.0.0.1 -U oncall -d oncall 2>/dev/null; do
    sleep 1
    waited=$((waited + 1))
    [ "$waited" -lt 90 ] || {
      echo "the test database did not start" >&2
      exit 1
    }
  done
}

start_standin() { # service
  mapfile -t label_args < <(labels "$1")
  podman run --detach --name "$run_id-$1" "${label_args[@]}" --read-only \
    --volume "$work/python:/usr/local/bin/python:ro" --volume "$work/alert:/alert" \
    --tmpfs /var/lib/postgresql/data --env ONCALL_SMTP_HOST=smtp.example.com "$image" sleep infinity >/dev/null
}

psql_db() { # [database] ; SQL on stdin
  podman exec -i "$run_id-db" psql -X -q -At -v ON_ERROR_STOP=1 -U oncall -d "${1:-oncall}"
}

# The script's files go under $home through the variables it reads. HOME
# itself stays: rootless Podman 4 finds its storage through it, and the script
# must see the test's containers.
run() {
  ONCALL_BACKUP_CONFIG=$home/.config/oncall/backup.conf XDG_STATE_HOME=$home/.local/state \
    ONCALL_BACKUP_DIR=$backups ONCALL_BACKUP_WAIT_SECONDS=${WAIT:-0} \
    bash "$script" --dir "$deploy" "$@" >"$work/out" 2>&1
}

verify_leftovers() {
  local left
  left=$(podman ps --all --quiet --filter "label=io.github.lowicz.oncall.backup-verify=$deploy")
  [ -z "$left" ] || fail "restore-test containers left behind: $left"
  left=$(podman volume ls --quiet | grep -v "^$run_id-data$" | comm -13 "$work/volumes-before" - || true)
  [ -z "$left" ] || fail "volumes left behind: $left"
  left=$(find "$backups" -maxdepth 1 -name '.tmp.*' 2>/dev/null)
  [ -z "$left" ] || fail "unfinished files left behind: $left"
}

# Nothing the script started (api, worker, a restore test) may keep its lock.
lock_is_free() {
  flock --nonblock "$home/.local/state/oncall-backup/lock" true || fail "the backup lock is still held"
}

newest() {
  find "$backups" -maxdepth 1 -name 'oncall-*.dump' | sort | tail -n 1
}

count() {
  find "$backups" -maxdepth 1 -name 'oncall-*.dump' | wc -l | tr -d ' '
}

podman volume ls --quiet | sort >"$work/volumes-before"
start_db
start_standin api
start_standin worker
start_standin web
psql_db <<'SQL'
create table alembic_version (version_num varchar(32) primary key);
insert into alembic_version values ('0035_outbox_created_index');
create table users (id serial primary key, username text, role text, is_active boolean, email text);
insert into users (username, role, is_active, email) values
  ('admin', 'admin', true, 'admin@example.com'),
  ('boss', 'admin', true, 'boss@example.com'),
  ('gone', 'admin', false, 'gone@example.com'),
  ('anna', 'member', true, 'anna@example.com'),
  ('nomail', 'admin', true, null);
create table audit_events (id serial primary key, summary text);
insert into audit_events (summary) select 'wpis ' || g from generate_series(1, 5000) g;
SQL
podman volume ls --quiet | sort >"$work/volumes-before"

check "a missing backup directory is refused with the command that creates it"
run dump && fail "succeeded without a backup directory"
has_text "$work/out" "$backups does not exist"
mkdir -m 755 "$backups"

check "an open backup directory is refused"
run dump && fail "succeeded with a 755 directory"
has_text "$work/out" "chmod 700 $backups"
chmod 700 "$backups"

check "a dump is written, proved by a restore and kept closed"
run dump --label daily || fail "exited $?: $(cat "$work/out")"
[ "$(count)" = 1 ] || fail "expected one backup, found $(count)"
file=$(newest)
case $(basename "$file") in
  oncall-*T*Z-daily-0035_outbox_created_index.dump) ;;
  *) fail "unexpected name $(basename "$file")" ;;
esac
[ "$(mode_of "$file")" = 600 ] || fail "backup mode is $(mode_of "$file")"
has_text "$work/out" "Restoring it into a throwaway container"
has_text "$home/.local/state/oncall-backup/last-success" "file=$file"
[ "$(mode_of "$home/.local/state/oncall-backup")" = 700 ] || fail "state directory is not 700"
verify_leftovers

check "list and status show the backup"
run list || fail "list exited $?"
has_text "$work/out" "$(basename "$file")"
run status || fail "status exited $?"
has_text "$work/out" "Keep:        30 newest"
has_text "$work/out" "Timer:       "
has_text "$work/out" "Time:        21:00 daily"
has_text "$work/out" "file=$file"

check "verify restores a kept backup"
run verify "$file" || fail "exited $?: $(cat "$work/out")"
has_text "$work/out" "restores: every table it holds came back"
verify_leftovers

check "a truncated backup does not pass verify, and leaves nothing behind"
head -c 2000 "$file" >"$work/truncated.dump"
run verify "$work/truncated.dump" && fail "a truncated file passed"
has_text "$work/out" "failed"
verify_leftovers

check "retention keeps the newest ONCALL_BACKUP_KEEP backups"
for day in 01 02 03 04 05; do
  : >"$backups/oncall-202001${day}T023000Z-daily-0034_old.dump"
done
: >"$backups/unrelated-file.dump"
ONCALL_BACKUP_KEEP=3 run dump || fail "exited $?: $(cat "$work/out")"
[ "$(count)" = 3 ] || fail "expected 3 backups, found $(count)"
[ -e "$file" ] || fail "the second newest backup was removed"
[ -e "$backups/oncall-20200105T023000Z-daily-0034_old.dump" ] || fail "the third newest backup was removed"
[ ! -e "$backups/oncall-20200104T023000Z-daily-0034_old.dump" ] || fail "an older backup survived"
[ -e "$backups/unrelated-file.dump" ] || fail "a file that is not a backup was removed"

check "the settings file is read, and the environment wins over it"
mkdir -p "$home/.config/oncall"
printf 'ONCALL_BACKUP_KEEP=2\nONCALL_BACKUP_ALERT_EMAIL=ops@example.com\n' >"$home/.config/oncall/backup.conf"
run dump || fail "exited $?: $(cat "$work/out")"
[ "$(count)" = 2 ] || fail "ONCALL_BACKUP_KEEP=2 from the file kept $(count)"
ONCALL_BACKUP_KEEP=4 run dump || fail "exited $?: $(cat "$work/out")"
[ "$(count)" = 3 ] || fail "the environment's ONCALL_BACKUP_KEEP=4 kept $(count)"
printf 'ONCALL_BACKUP_KEPT=2\n' >"$home/.config/oncall/backup.conf"
run status && fail "an unknown setting was accepted"
has_text "$work/out" "unknown setting: ONCALL_BACKUP_KEPT=2"
printf 'ONCALL_BACKUP_OWNER=somebody-else\nONCALL_BACKUP_ALERT_EMAIL=ops@example.com, boss@example.com\n' \
  >"$home/.config/oncall/backup.conf"
run dump && fail "ran for another owner"
has_text "$work/out" "backups belong to somebody-else"
printf 'ONCALL_BACKUP_ALERT_EMAIL=ops@example.com, boss@example.com\n' >"$home/.config/oncall/backup.conf"

check "a lost database fails the dump, keeps every backup and records why"
before=$(count)
podman stop --time 5 "$run_id-db" >/dev/null
run dump && fail "succeeded without a database"
has_text "$work/out" "not running or not ready"
[ "$(count)" = "$before" ] || fail "a backup was removed or added"
has_text "$home/.local/state/oncall-backup/last-failure" "step=preflight"
has_text "$home/.local/state/oncall-backup/last-failure" "not running or not ready"
run status || fail "status exited $?"
has_text "$work/out" "Last failure:"
if grep -Eq '[[:space:]]$' "$work/out"; then
  fail "status prints trailing whitespace: $(grep -En '[[:space:]]$' "$work/out")"
fi
verify_leftovers

check "the dump waits for a database that is still starting"
( sleep 6 && podman start "$run_id-db" >/dev/null ) &
WAIT=90 run dump || fail "exited $?: $(cat "$work/out")"
wait
has_text "$work/out" "Waiting up to 90s for the database"
[ "$(count)" = $((before + 1)) ] || fail "expected $((before + 1)) backups after the waited dump, found $(count)"

check "the alert sends the recorded failure to every recipient through api"
printf 'time=2026-09-24T02:30:05+02:00\nstep=verify\nlabel=daily\n\nerror: restore test failed\npg_restore: bad input\n' \
  >"$home/.local/state/oncall-backup/last-failure"
run alert || fail "exited $?: $(cat "$work/out")"
has_text "$work/out" "backup alert sent"
has_text "$work/alert/args" "ops@example.com"
has_text "$work/alert/args" "boss@example.com"
has_text "$work/alert/args" "verify"
has_text "$work/alert/args" "2026-09-24T02:30:05+02:00"
has_text "$work/alert/stdin" "pg_restore: bad input"
lacks_text "$work/alert/stdin" "step=verify"

check "the test alert says so and carries no failure"
run alert --test || fail "exited $?: $(cat "$work/out")"
has_text "$work/alert/args" "--test"
has_text "$work/alert/args" "test"

check "the alert falls back to worker when api is down"
podman stop --time 0 "$run_id-api" >/dev/null
rm -f "$work/alert/args"
run alert --test || fail "exited $?: $(cat "$work/out")"
[ -f "$work/alert/args" ] || fail "worker did not send the alert"
podman start "$run_id-api" >/dev/null

check "admin-emails lists active administrators with an address"
run admin-emails || fail "exited $?: $(cat "$work/out")"
[ "$(cat "$work/out")" = "$(printf 'admin@example.com\nboss@example.com')" ] || fail "got: $(cat "$work/out")"

check "check reports the stack and the SMTP server"
run check || fail "exited $?: $(cat "$work/out")"
has_text "$work/out" "alerts: sent through smtp.example.com"

check "cleanup removes what a killed run left, and only that"
mapfile -t label_args < <(labels verify-leftover)
podman run --detach --name "$run_id-leftover" "${label_args[@]}" \
  --label "io.github.lowicz.oncall.backup-verify=$deploy" --tmpfs /var/lib/postgresql/data "$image" sleep infinity >/dev/null
podman run --detach --name "$run_id-other" --label "$run_id" \
  --label "io.github.lowicz.oncall.backup-verify=/some/other/deployment" --tmpfs /var/lib/postgresql/data \
  "$image" sleep infinity >/dev/null
: >"$backups/.tmp.oncall-20260101T000000Z-daily-x.dump"
run cleanup || fail "exited $?: $(cat "$work/out")"
podman container exists "$run_id-leftover" && fail "the leftover restore-test container survived"
podman container exists "$run_id-other" || fail "another deployment's container was removed"
[ ! -e "$backups/.tmp.oncall-20260101T000000Z-daily-x.dump" ] || fail "the unfinished file survived"
podman rm --force --volumes --time 0 "$run_id-other" >/dev/null

check "a dump stopped during its restore test removes the restore-test container"
(
  for _ in $(seq 300); do
    if [ -n "$(podman ps --quiet --filter "label=io.github.lowicz.oncall.backup-verify=$deploy")" ]; then
      pkill -TERM -f "oncall-backup.sh --dir $deploy dump --label interrupted"
      exit 0
    fi
    sleep 0.1
  done
) &
run dump --label interrupted
[ "$?" -eq 143 ] || fail "the stopped dump did not exit with 143: $(cat "$work/out")"
wait
verify_leftovers
lacks_text "$work/out" "Backup: "
lock_is_free
[ ! -e "$home/.local/state/oncall-backup/running" ] || fail "a stopped dump left its running marker"

check "a dump killed outright is recorded as failed by cleanup, as the unit's ExecStopPost runs it"
(
  for _ in $(seq 300); do
    if [ -n "$(podman ps --quiet --filter "label=io.github.lowicz.oncall.backup-verify=$deploy")" ]; then
      pkill -KILL -f "oncall-backup.sh --dir $deploy dump --label killed"
      exit 0
    fi
    sleep 0.1
  done
) &
run dump --label killed
[ "$?" -eq 137 ] || fail "the killed dump did not exit with 137: $(cat "$work/out")"
wait
state=$home/.local/state/oncall-backup
has_text "$state/running" "step=verify"
SERVICE_RESULT=signal EXIT_CODE=killed EXIT_STATUS=KILL run cleanup || fail "cleanup exited $?: $(cat "$work/out")"
has_text "$state/last-failure" "step=verify"
has_text "$state/last-failure" "label=killed"
has_text "$state/last-failure" "stopped during verify before it could finish (systemd: result=signal code=killed status=KILL)"
[ ! -e "$state/running" ] || fail "cleanup left the running marker"
verify_leftovers
lock_is_free
run dump || fail "exited $?: $(cat "$work/out")"
[ ! -e "$state/running" ] || fail "a finished dump left its running marker"

check "restore puts the backup back, keeps a pre-restore backup and restarts api, worker and web"
keep_file=$(newest)
psql_db <<<"delete from audit_events where id > 100; insert into users (username, role, is_active) values ('late', 'member', true)"
# A migration after the backup: the backup no longer has every live table.
psql_db <<<"create table later_migration (id int); update alembic_version set version_num = '0036_later'"
run restore "$keep_file" && fail "restored without --yes off a terminal"
has_text "$work/out" "pass --yes"
ONCALL_BACKUP_KEEP=10 run restore "$keep_file" --yes || fail "exited $?: $(cat "$work/out")"
if grep -q NOTICE "$work/out"; then
  fail "restore prints server notices: $(grep NOTICE "$work/out")"
fi
[ "$(psql_db <<<'select count(*) from audit_events')" = 5000 ] || fail "audit_events not restored"
[ "$(psql_db <<<"select count(*) from users where username = 'late'")" = 0 ] || fail "a later row survived"
[ "$(psql_db <<<"select count(*) from pg_tables where tablename = 'later_migration'")" = 0 ] ||
  fail "a later table survived"
[ "$(psql_db <<<'select version_num from alembic_version')" = 0035_outbox_created_index ] ||
  fail "the schema revision was not restored"
[ "$(podman inspect --format '{{.State.Running}}' "$run_id-api")" = true ] || fail "api is not running"
[ "$(podman inspect --format '{{.State.Running}}' "$run_id-worker")" = true ] || fail "worker is not running"
[ "$(podman inspect --format '{{.State.Running}}' "$run_id-web")" = true ] || fail "web is not running"
api_started=$(podman inspect --format '{{.State.StartedAt.UnixNano}}' "$run_id-api")
web_started=$(podman inspect --format '{{.State.StartedAt.UnixNano}}' "$run_id-web")
[ "$web_started" -gt "$api_started" ] || fail "web started before api, so nginx could keep api's old address"
compgen -G "$backups/oncall-*-pre-restore-*.dump" >/dev/null || fail "no pre-restore backup"
[ "$(psql_db postgres <<<"select count(*) from pg_database where datname like 'oncall_%restore'")" = 0 ] ||
  fail "a side database was left"
verify_leftovers
lock_is_free

check "a backup that does not restore leaves the database and the services as they were"
psql_db <<<"insert into users (username, role, is_active) values ('kept', 'member', true)"
ONCALL_BACKUP_KEEP=10 run restore "$work/truncated.dump" --yes && fail "restored a truncated file"
[ "$(psql_db <<<"select count(*) from users where username = 'kept'")" = 1 ] || fail "the database changed"
[ "$(podman inspect --format '{{.State.Running}}' "$run_id-api")" = true ] || fail "api is not running"
[ "$(podman inspect --format '{{.State.Running}}' "$run_id-web")" = true ] || fail "web is not running"
verify_leftovers

if [ "$failures" -ne 0 ]; then
  printf '%s check(s) failed\n' "$failures" >&2
  exit 1
fi
echo "deploy/backup/oncall-backup.sh: all checks passed"
