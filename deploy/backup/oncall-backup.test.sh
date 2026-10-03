#!/usr/bin/env bash
# Tests for deploy/backup/oncall-backup.sh against real rootless Podman: a
# PostgreSQL container started with the db service's Compose hardening and
# labels, and api/worker stand-ins whose `python` records the alert it was
# asked to send, plus a web stand-in. upgrade-postgres is tested last, from a
# PostgreSQL 17 db service that Compose itself starts from the stack's file as
# it was, to the one the stack names now; there Compose starts the api, worker
# and web stand-ins too, so they depend on db as the stack's own containers do.
# `podman compose` runs whichever provider it finds; PODMAN_COMPOSE_PROVIDER
# picks one (CI runs this with docker-compose and with podman-compose). What
# the script writes lives in a temporary directory, removed at exit with every
# container, volume and network the test made.
#
#   bash deploy/backup/oncall-backup.test.sh
set -u
# The caller's own settings must not leak into the runs.
unset ONCALL_BACKUP_CONFIG ONCALL_BACKUP_DIR ONCALL_BACKUP_KEEP ONCALL_BACKUP_OWNER \
  ONCALL_BACKUP_ALERT_EMAIL ONCALL_BACKUP_WAIT_SECONDS

repo_root=$(cd "$(dirname "$0")/../.." && pwd -P)
script=$repo_root/deploy/backup/oncall-backup.sh
# The stack's PostgreSQL release, as docker-compose.yml names it.
stack_image=$(awk '$1 == "image:" && $2 ~ /^postgres:[0-9]/ { print $2; exit }' "$repo_root/docker-compose.yml")
[ -n "$stack_image" ] || {
  echo "$repo_root/docker-compose.yml names no postgres image" >&2
  exit 1
}
image=${ONCALL_BACKUP_TEST_IMAGE:-docker.io/library/$stack_image}
old_image=${ONCALL_BACKUP_TEST_OLD_IMAGE:-docker.io/library/postgres:17-alpine}
work=$(mktemp -d)
run_id=oncall-backup-test-$$
failures=0
current_test=""
service_pid=""

cleanup() {
  local ids volume
  ids=$(podman ps --all --quiet --filter "label=$run_id")
  ids+=" $(podman ps --all --quiet --filter "label=io.github.lowicz.oncall.backup-verify=$deploy")"
  ids+=" $(podman ps --all --quiet --filter "label=com.docker.compose.project=$run_id")"
  # --depend: Podman removes no container another one requires (podman-compose
  # makes api, worker and web require db) unless those go with it.
  # shellcheck disable=SC2086 # one ID per word
  podman rm --force --depend --volumes --time 0 $ids >/dev/null 2>&1
  # podman-compose puts the project's containers in a pod of its own.
  podman pod rm --force "pod_$run_id" >/dev/null 2>&1
  for volume in $(podman volume ls --quiet | grep "^${run_id}[-_]"); do
    podman volume rm --force "$volume" >/dev/null 2>&1
  done
  podman network rm --force "${run_id}_default" >/dev/null 2>&1
  if [ -n "$service_pid" ]; then
    kill "$service_pid" 2>/dev/null
  fi
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

for pulled in "$image" "$old_image"; do
  podman image exists "$pulled" || podman pull --quiet "$pulled" >/dev/null || {
    echo "cannot pull $pulled" >&2
    exit 1
  }
done
# Where the image keeps its data: its one declared volume (PostgreSQL 18
# declares /var/lib/postgresql, 17 /var/lib/postgresql/data). Containers of it
# that need no data get a tmpfs there, so Podman creates no anonymous volume.
data_path=$(podman image inspect --format '{{range $path, $_ := .Config.Volumes}}{{$path}}{{end}}' "$image")

labels() { # service
  printf -- '--label\n%s\n' "$run_id" "com.docker.compose.project=$run_id" \
    "com.docker.compose.project.working_dir=$deploy" "com.docker.compose.service=$1"
}

start_db() {
  mapfile -t label_args < <(labels db)
  podman run --detach --name "$run_id-db" "${label_args[@]}" \
    --security-opt no-new-privileges:true --read-only --tmpfs /var/run/postgresql --tmpfs /tmp \
    --cap-drop ALL --cap-add CHOWN --cap-add DAC_READ_SEARCH --cap-add FOWNER --cap-add SETGID --cap-add SETUID \
    --env POSTGRES_DB=oncall --env POSTGRES_USER=oncall --env POSTGRES_PASSWORD=test \
    --volume "$run_id-data:$data_path" "$image" >/dev/null
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
    --tmpfs "$data_path" --env ONCALL_SMTP_HOST=smtp.example.com "$image" sleep infinity >/dev/null
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
  left=$(podman volume ls --quiet | sort | grep -v "^$run_id-data$" | comm -13 "$work/volumes-before" - || true)
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

check "before setup.sh has run, a dump (update.sh's) creates the directory, closed"
run dump --label pre-update-1.0.0-to-2.0.0 || fail "exited $?: $(cat "$work/out")"
has_text "$work/out" "Created $backups"
[ "$(mode_of "$backups")" = 700 ] || fail "the created directory is $(mode_of "$backups")"
[ "$(count)" = 1 ] || fail "expected one backup, found $(count)"
rm -rf "${backups:?}"

check "once set up, a missing backup directory is refused with the command that creates it"
mkdir -p "$home/.config/oncall"
printf '# written by the test: backups are set up\n' >"$home/.config/oncall/backup.conf"
run dump && fail "succeeded without a backup directory"
has_text "$work/out" "$backups does not exist"
[ ! -e "$backups" ] || fail "created the directory although backups are set up"
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
  --label "io.github.lowicz.oncall.backup-verify=$deploy" --tmpfs "$data_path" "$image" sleep infinity >/dev/null
podman run --detach --name "$run_id-other" --label "$run_id" \
  --label "io.github.lowicz.oncall.backup-verify=/some/other/deployment" --tmpfs "$data_path" \
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

# --- upgrade-postgres ---------------------------------------------------------

# `podman compose` hands the Compose file to a provider (docker-compose or
# podman-compose) that talks to Podman's API socket. The test serves its own
# socket, so it neither needs the user's podman.socket nor reaches a Docker
# daemon, and finds a docker-compose plugin where Docker installs one.
socket=${XDG_RUNTIME_DIR:-/tmp}/$run_id.sock
podman system service --time=0 "unix://$socket" >/dev/null 2>&1 &
service_pid=$!
for _ in $(seq 100); do
  [ -S "$socket" ] && break
  sleep 0.1
done
export DOCKER_HOST=unix://$socket
if ! podman compose version >/dev/null 2>&1; then
  mkdir -p "$work/bin"
  for plugin in /usr/libexec/docker/cli-plugins/docker-compose /usr/lib/docker/cli-plugins/docker-compose \
    /usr/local/lib/docker/cli-plugins/docker-compose; do
    if [ -x "$plugin" ]; then
      ln -s "$plugin" "$work/bin/docker-compose"
      break
    fi
  done
  export PATH=$work/bin:$PATH
fi
podman compose version >/dev/null 2>&1 || {
  echo "podman compose does not work here: $(podman compose version 2>&1 | tail -n 3)" >&2
  exit 1
}

# The stack's Compose file as releases on PostgreSQL 17 had it: that image, its
# volume on the old data path, no initdb settings. And one whose db is still
# 17 on a volume of its own, which is no upgrade.
sed -e 's/image: postgres:[0-9.]*-alpine/image: postgres:17-alpine/' \
  -e 's|- oncall-postgres-[0-9]*:/var/lib/postgresql$|- oncall-db:/var/lib/postgresql/data|' \
  -e 's/^  oncall-postgres-[0-9]*:$/  oncall-db:/' -e '/POSTGRES_INITDB_ARGS/d' \
  "$deploy/docker-compose.yml" >"$deploy/compose-17.yml"
sed -e 's/oncall-db/oncall-other/' "$deploy/compose-17.yml" >"$deploy/compose-17-other.yml"
# web publishes its ports on the host, so on ports no other run takes.
printf 'ONCALL_VERSION=0.0.0-test\nPOSTGRES_PASSWORD=test\nONCALL_WEB_HTTP_PORT=%s\nONCALL_WEB_HTTPS_PORT=%s\n' \
  $((20000 + $$ % 20000)) $((40000 + $$ % 20000)) >"$work/stack.env"
# api, worker and web as Compose starts them from the stack's file, on the test
# image: they sleep, api's health check (`python -c ...`) passes, and the
# image's data directory is a tmpfs, so Compose creates no volume for them.
printf '#!/bin/sh\nexit 0\n' >"$work/healthy"
chmod 755 "$work/healthy"
cat >"$work/standins.yml" <<EOF
services:
  api:
    image: $image
    entrypoint: ["sleep"]
    command: ["infinity"]
    tmpfs:
      - $data_path
    volumes:
      - $work/healthy:/usr/local/bin/python:ro
  worker:
    image: $image
    entrypoint: ["sleep"]
    command: ["infinity"]
    tmpfs:
      - $data_path
  web:
    image: $image
    entrypoint: ["sleep"]
    command: ["infinity"]
    tmpfs:
      - $data_path
EOF
grep -q 'oncall-db:/var/lib/postgresql/data' "$deploy/compose-17.yml" || {
  echo "$deploy/compose-17.yml does not mount oncall-db on the old data path" >&2
  exit 1
}
grep -q 'image: postgres:17-alpine$' "$deploy/compose-17.yml" || {
  echo "$deploy/compose-17.yml does not run postgres:17-alpine" >&2
  exit 1
}

# Every file is in $deploy, which Compose then takes as the project directory.
stack() {
  podman compose --project-name "$run_id" --env-file "$work/stack.env" "$@"
}

# The volume the stack's db keeps its data in now, as Compose reads the file:
# the one key under its top-level volumes.
new_volume_key=$(stack -f "$deploy/docker-compose.yml" config 2>/dev/null |
  awk '/^volumes:/ { found = 1; next } found && /^  [^ ]/ { sub(/^  /, ""); sub(/:.*/, ""); print; exit }')
new_volume=${run_id}_$new_volume_key
case $new_volume_key in
  '' | *[[:space:]]*) echo "expected one volume in docker-compose.yml, Compose reads: $new_volume_key" >&2 && exit 1 ;;
esac

# The labels both providers put on a service's container (the stand-in db is
# gone by then, and the other stand-ins are other services).
stack_db() {
  podman ps --all --quiet --filter "label=com.docker.compose.project=$run_id" \
    --filter "label=com.docker.compose.service=db"
}

stack_psql() { # SQL on stdin
  podman exec -i "$(stack_db)" psql -X -q -At -v ON_ERROR_STOP=1 -U oncall -d oncall
}

# What systemctl --user restart oncall.service does for the db: Compose starts
# the service its installed file names.
start_stack_db() { # compose file
  stack -f "$1" up --detach --no-deps db >/dev/null 2>&1 || fail "Compose did not start db from $1"
  local waited=0
  until podman exec "$(stack_db)" pg_isready -q -h 127.0.0.1 -U oncall -d oncall 2>/dev/null; do
    sleep 1
    waited=$((waited + 1))
    [ "$waited" -lt 90 ] || {
      echo "the stack's database did not start" >&2
      exit 1
    }
  done
}

# What the stack's start does for api, worker and web: podman-compose makes
# each container require the ones its service depends on.
start_stack_services() { # compose file
  stack -f "$1" -f "$work/standins.yml" up --detach api worker web >/dev/null 2>&1 ||
    fail "Compose did not start api, worker and web from $1"
}

running() { # service
  [ -n "$(podman ps --quiet --filter "label=com.docker.compose.project=$run_id" \
    --filter "label=com.docker.compose.service=$1" --filter status=running)" ]
}

podman rm --force --time 0 "$run_id-db" "$run_id-api" "$run_id-worker" "$run_id-web" >/dev/null
start_stack_db "$deploy/compose-17.yml"
start_stack_services "$deploy/compose-17.yml"
stack_psql <<'SQL'
create table alembic_version (version_num varchar(32) primary key);
insert into alembic_version values ('0035_outbox_created_index');
create table team_members (id serial primary key, display_name varchar(160) not null);
insert into team_members (display_name) values
  ('Żaneta'), ('Marek'), ('Łukasz'), ('ala'), ('Lech'), ('Ewa'), ('Śliwa'), ('Adam');
create table audit_events (id serial primary key, summary text);
insert into audit_events (summary) select 'wpis ' || g from generate_series(1, 5000) g;
SQL
podman volume ls --quiet | sort >"$work/volumes-before"

check "upgrade-postgres refuses a Compose file whose PostgreSQL is not newer, and removes what it created"
run upgrade-postgres --env-file "$work/stack.env" "$deploy/compose-17-other.yml" && fail "upgraded to the same major version"
has_text "$work/out" "runs PostgreSQL 17, which is not newer than 17"
has_text "$work/out" "PostgreSQL 17's data is unchanged in the volume ${run_id}_oncall-db"
has_text "$work/out" "systemctl --user restart oncall.service"
podman volume exists "${run_id}_oncall-other" && fail "the volume it created survived"
running api && fail "api was started again, onto a database that is not the stack's"
verify_leftovers
lock_is_free
start_stack_db "$deploy/compose-17.yml"
[ "$(stack_psql <<<'select count(*) from audit_events')" = 5000 ] || fail "PostgreSQL 17's data changed"
[ "$(stack_psql <<<'show server_version_num' | cut -c1-2)" = 17 ] || fail "the stack's db is not PostgreSQL 17 again"

[ ! -e "$deploy/.upgrade-postgres.compose.yml" ] || fail "the copy of the Compose file was left behind"

# The volume as Compose creates it for the stack's db service.
create_new_volume() {
  podman volume create --label "com.docker.compose.project=$run_id" --label "com.docker.compose.volume=$new_volume_key" \
    "$new_volume" >/dev/null
}

check "upgrade-postgres leaves a volume that already holds data alone"
create_new_volume
# A data directory as PostgreSQL leaves it: its owner's alone.
podman run --rm --volume "$new_volume:/volume" "$image" \
  sh -c 'mkdir /volume/18 && echo 18 >/volume/18/PG_VERSION && chown -R postgres:postgres /volume/18 && chmod 700 /volume/18'
podman volume ls --quiet | sort >"$work/volumes-before"
run upgrade-postgres --env-file "$work/stack.env" "$deploy/docker-compose.yml" && fail "upgraded into an existing volume"
has_text "$work/out" "the volume $new_volume of the new database already exists"
podman volume exists "$new_volume" || fail "the existing volume was removed"
[ "$(podman run --rm --volume "$new_volume:/volume:ro" "$image" cat /volume/18/PG_VERSION)" = 18 ] ||
  fail "the existing volume's data changed"
[ -z "$(stack_db)" ] || fail "the new database's container was left behind"
verify_leftovers
podman volume rm "$new_volume" >/dev/null
podman volume ls --quiet | sort >"$work/volumes-before"
start_stack_db "$deploy/compose-17.yml"

check "upgrade-postgres moves the database to PostgreSQL 18 on a new volume, with checksums and Polish collation"
start_stack_services "$deploy/compose-17.yml"
for service in api worker web; do
  running "$service" || fail "$service does not run before the upgrade"
done
stack_psql <<<"insert into audit_events (summary) values ('the last change before the upgrade')"
backups_before=$(count)
# What a run that Podman refused to create the new db container for left
# behind: Compose had created its volume, and nothing wrote to it.
create_new_volume
run upgrade-postgres --env-file "$work/stack.env" "$deploy/docker-compose.yml" || fail "exited $?: $(cat "$work/out")"
has_text "$work/out" "The volume $new_volume already exists and is empty"
has_text "$work/out" "PostgreSQL 18 holds the database (schema 0035_outbox_created_index): page checksums on, collation pl-PL (ICU)."
has_text "$work/out" "PostgreSQL 17's data stays in the volume ${run_id}_oncall-db as the way back"
[ "$(podman ps --all --quiet --filter "label=com.docker.compose.project=$run_id" --filter label=com.docker.compose.service=db | wc -l | tr -d ' ')" = 1 ] ||
  fail "more than one db container"
[ "$(stack_psql <<<'show server_version_num' | cut -c1-2)" = 18 ] || fail "the stack's db is not PostgreSQL 18"
# Each major version needs a volume of its own: upgrade-postgres refuses one
# that exists, so a new image on the old name could not be moved to.
[ "$new_volume_key" = "oncall-postgres-$(($(stack_psql <<<'show server_version_num') / 10000))" ] ||
  fail "db keeps its data in the volume $new_volume_key; name it after the PostgreSQL major version in docker-compose.yml"
[ "$(stack_psql <<<'select count(*) from audit_events')" = 5001 ] || fail "not every row came across"
[ "$(stack_psql <<<'select version_num from alembic_version')" = 0035_outbox_created_index ] ||
  fail "the schema revision did not come across"
[ "$(stack_psql <<<'show data_checksums')" = on ] || fail "page checksums are off"
[ "$(stack_psql <<<"select string_agg(display_name, ',' order by display_name) from team_members")" = \
  "Adam,ala,Ewa,Lech,Łukasz,Marek,Śliwa,Żaneta" ] || fail "names do not sort in Polish order"
[ -n "$(stack_psql <<<"select last_analyze from pg_stat_user_tables where relname = 'audit_events'")" ] ||
  fail "the restored database was not analysed"
podman volume exists "${run_id}_oncall-db" || fail "PostgreSQL 17's volume was removed"
[ "$(podman run --rm --volume "${run_id}_oncall-db:/old:ro" "$old_image" cat /old/PG_VERSION)" = 17 ] ||
  fail "PostgreSQL 17's data directory is not intact"
for service in api worker web; do
  running "$service" && fail "$service runs; the stack must start from the files that name the new database"
done
[ "$(count)" = $((backups_before + 1)) ] || fail "expected one more backup, found $(count)"
compgen -G "$backups/oncall-*-pre-postgres-upgrade-from-17-0035_outbox_created_index.dump" >/dev/null ||
  fail "no pre-upgrade backup"
podman volume ls --quiet | sort | grep -v "^$new_volume$" >"$work/volumes-now"
[ -z "$(comm -13 "$work/volumes-before" "$work/volumes-now")" ] ||
  fail "volumes left behind: $(comm -13 "$work/volumes-before" "$work/volumes-now")"
podman volume ls --quiet | sort >"$work/volumes-before"
verify_leftovers
lock_is_free

check "the stack starts again on the file that names PostgreSQL 18"
start_stack_services "$deploy/docker-compose.yml"
for service in api worker web; do
  running "$service" || fail "$service does not run"
done
[ "$(stack_psql <<<'show server_version_num' | cut -c1-2)" = 18 ] || fail "the stack's db is not PostgreSQL 18"
[ "$(stack_psql <<<'select count(*) from audit_events')" = 5001 ] || fail "the stack does not run on the upgraded database"

check "the database upgraded to PostgreSQL 18 is dumped and proved like any other"
run dump --label after-upgrade || fail "exited $?: $(cat "$work/out")"
has_text "$work/out" "Restoring it into a throwaway container"
verify_leftovers

if [ "$failures" -ne 0 ]; then
  printf '%s check(s) failed\n' "$failures" >&2
  exit 1
fi
echo "deploy/backup/oncall-backup.sh: all checks passed"
