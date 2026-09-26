#!/usr/bin/env bash
# Tests for deploy/backup/setup.sh with systemctl, loginctl, podman and
# oncall-backup.sh replaced by stubs that log their calls. Nothing leaves the
# temporary directory: HOME, the checkout and the unit directory live there.
#
#   bash deploy/backup/setup.test.sh
set -u

repo_root=$(cd "$(dirname "$0")/../.." && pwd -P)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failures=0
current_test=""
me=$(id -un)

fail() {
  printf 'FAIL %s: %s\n' "$current_test" "$*" >&2
  failures=$((failures + 1))
}

check() {
  current_test=$1
}

has_line() {
  grep -Fqx -- "$2" "$1" || fail "$1 lacks the line: $2 ($(cat "$1"))"
}

lacks_line() {
  if grep -Fqx -- "$2" "$1"; then
    fail "$1 still has the line: $2"
  fi
}

has_text() {
  grep -Fq -- "$2" "$1" || fail "$1 lacks: $2 ($(tail -n 3 "$1"))"
}

stubs=$work/bin
mkdir -p "$stubs"
cat >"$stubs/systemctl" <<'EOF'
#!/bin/sh
echo "systemctl $*" >>"$TEST_LOG"
[ "$1" = --user ] && shift
case $1 in
  show-environment) exit "${TEST_NO_MANAGER:-0}" ;;
  show)
    case $3 in
      LoadState) echo "${TEST_LOAD_STATE:-loaded}" ;;
      WorkingDirectory) echo "$TEST_WORKING_DIRECTORY" ;;
    esac
    ;;
  start) exit "${TEST_START_FAIL:-0}" ;;
esac
EOF
cat >"$stubs/loginctl" <<'EOF'
#!/bin/sh
echo "loginctl $*" >>"$TEST_LOG"
case $1 in
  show-user) cat "$TEST_LINGER_FILE" ;;
  enable-linger)
    [ "${TEST_LINGER_ENABLE:-ok}" = ok ] || exit 1
    echo yes >"$TEST_LINGER_FILE"
    ;;
esac
EOF
cat >"$stubs/podman" <<'EOF'
#!/bin/sh
echo "podman $*" >>"$TEST_LOG"
EOF
cat >"$stubs/journalctl" <<'EOF'
#!/bin/sh
echo "journalctl $*" >>"$TEST_LOG"
exit "${TEST_JOURNAL_UNREADABLE:-0}"
EOF
chmod +x "$stubs/systemctl" "$stubs/loginctl" "$stubs/journalctl" "$stubs/podman"

# A checkout with the real setup script and units and a stub oncall-backup.sh.
new_checkout() {
  checkout=$work/$1
  rm -rf "$checkout" "${work:?}/home"
  mkdir -p "$checkout/deploy/backup" "$work/home"
  cp "$repo_root/docker-compose.yml" "$checkout/"
  for file in setup.sh oncall-backup.service oncall-backup-alert.service oncall-backup.timer; do
    cp "$repo_root/deploy/backup/$file" "$checkout/deploy/backup/$file"
  done
  cat >"$checkout/deploy/backup/oncall-backup.sh" <<'EOF'
#!/bin/sh
echo "oncall-backup.sh $* dir=${ONCALL_BACKUP_DIR:-}" >>"$TEST_LOG"
case $1 in
  admin-emails) printf 'admin@example.com\nboss@example.com\n' ;;
  check) exit "${TEST_CHECK_FAIL:-0}" ;;
esac
EOF
  checkout=$(cd "$checkout" && pwd -P)
  echo yes >"$work/linger-state"
  : >"$work/log"
  TEST_WORKING_DIRECTORY=$checkout
  export TEST_WORKING_DIRECTORY
}

config=$work/home/.config/oncall/backup.conf
units=$work/home/.config/systemd/user

run_setup() {
  PATH="$stubs:$PATH" HOME="$work/home" XDG_CONFIG_HOME="" XDG_RUNTIME_DIR="$work" \
    TEST_LOG="$work/log" TEST_LINGER_FILE="$work/linger-state" \
    bash "$checkout/deploy/backup/setup.sh" "$@" >"$work/out" 2>&1
}

check "a first run writes the settings, the directory and the units, then backs up"
new_checkout plain
run_setup || fail "exited $?: $(cat "$work/out")"
has_line "$config" "ONCALL_BACKUP_OWNER=$me"
has_line "$config" "ONCALL_BACKUP_DIR=$work/home/oncall-backups"
has_line "$config" "ONCALL_BACKUP_KEEP=30"
has_line "$config" "ONCALL_BACKUP_ALERT_EMAIL=admin@example.com,boss@example.com"
[ "$(stat -c %a "$config")" = 600 ] || fail "settings mode is $(stat -c %a "$config")"
[ "$(stat -c %a "$work/home/oncall-backups")" = 700 ] || fail "backup directory is not 700"
for unit in oncall-backup.service oncall-backup-alert.service oncall-backup.timer; do
  cmp -s "$units/$unit" "$repo_root/deploy/backup/$unit" || fail "$unit was not installed"
done
has_line "$units/oncall-backup.service.d/checkout.conf" "WorkingDirectory=$checkout"
has_line "$units/oncall-backup-alert.service.d/checkout.conf" "WorkingDirectory=$checkout"
has_line "$work/log" "systemctl --user daemon-reload"
has_line "$work/log" "systemctl --user enable --now oncall-backup.timer"
has_line "$work/log" "systemctl --user start oncall-backup.service"
has_line "$work/log" "oncall-backup.sh check dir="
has_line "$work/log" "oncall-backup.sh status dir="
[ "$(grep -n 'enable --now' "$work/log" | cut -d: -f1)" -lt "$(grep -n 'start oncall-backup.service' "$work/log" | cut -d: -f1)" ] ||
  fail "the first backup ran before the timer was enabled"
has_text "$work/out" "Backups belong to $me"
if grep -Fq "cannot read its own journal" "$work/out"; then
  fail "warned about a readable journal"
fi

check "a second run keeps every value it is not given"
: >"$work/log"
run_setup --keep 14 --no-first-backup || fail "exited $?: $(cat "$work/out")"
has_line "$config" "ONCALL_BACKUP_KEEP=14"
has_line "$config" "ONCALL_BACKUP_DIR=$work/home/oncall-backups"
has_line "$config" "ONCALL_BACKUP_ALERT_EMAIL=admin@example.com,boss@example.com"
lacks_line "$work/log" "systemctl --user start oncall-backup.service"
if grep -Fq "oncall-backup.sh admin-emails" "$work/log"; then
  fail "looked the administrators up again"
fi

check "a setting the file already has for the wait survives a run"
printf 'ONCALL_BACKUP_WAIT_SECONDS=120\n' >>"$config"
run_setup --no-first-backup || fail "exited $?: $(cat "$work/out")"
has_line "$config" "ONCALL_BACKUP_WAIT_SECONDS=120"

check "the directory and the alert address can be changed"
run_setup --backup-dir "$work/elsewhere/" --alert-email "ops@example.com, oncall@example.com" --no-first-backup ||
  fail "exited $?: $(cat "$work/out")"
has_line "$config" "ONCALL_BACKUP_DIR=$work/elsewhere"
has_line "$config" "ONCALL_BACKUP_ALERT_EMAIL=ops@example.com,oncall@example.com"
[ "$(stat -c %a "$work/elsewhere")" = 700 ] || fail "the new directory is not 700"

check "an open existing directory is closed"
chmod 755 "$work/elsewhere"
run_setup --no-first-backup || fail "exited $?: $(cat "$work/out")"
[ "$(stat -c %a "$work/elsewhere")" = 700 ] || fail "the directory stayed open"

check "bad values are refused before anything changes"
cp "$config" "$work/config-before"
run_setup --keep 0 && fail "accepted --keep 0"
has_text "$work/out" "--keep must be a whole number of at least 1"
run_setup --backup-dir relative/dir && fail "accepted a relative directory"
has_text "$work/out" "must be an absolute path"
run_setup --backup-dir "$checkout/backups" && fail "accepted a directory inside the checkout"
has_text "$work/out" "inside the deployment checkout"
run_setup --alert-email "not-an-address" && fail "accepted a bad address"
has_text "$work/out" "not an e-mail address: not-an-address"
cmp -s "$config" "$work/config-before" || fail "a refused run changed the settings"

check "another owner is refused, by flag and by the settings file"
run_setup --owner somebody-else && fail "ran for another owner"
has_text "$work/out" "log in as somebody-else"
sed -i "s/^ONCALL_BACKUP_OWNER=.*/ONCALL_BACKUP_OWNER=somebody-else/" "$config"
run_setup && fail "ran over another owner's settings"
has_text "$work/out" "says the backups belong to somebody-else"

check "the stack's user and checkout are required"
new_checkout guards
TEST_LOAD_STATE=not-found run_setup && fail "ran without oncall.service"
has_text "$work/out" "oncall.service is not installed for $me"
TEST_WORKING_DIRECTORY=/somewhere/else run_setup && fail "ran for another checkout"
has_text "$work/out" "runs /somewhere/else, not $checkout"
TEST_NO_MANAGER=1 run_setup && fail "ran without a user manager"
has_text "$work/out" "cannot reach your systemd user manager"
[ ! -e "$config" ] || fail "a refused run wrote settings"

check "linger is switched on, or the run stops with the administrator's command"
new_checkout linger
echo no >"$work/linger-state"
run_setup --no-first-backup || fail "exited $?: $(cat "$work/out")"
has_line "$work/log" "loginctl enable-linger $me"
new_checkout no-linger
echo no >"$work/linger-state"
TEST_LINGER_ENABLE=denied run_setup && fail "ran without linger"
has_text "$work/out" "sudo loginctl enable-linger $me"

check "a failed first backup fails the setup and says where to look"
new_checkout first-fails
TEST_START_FAIL=1 run_setup && fail "succeeded although the first backup failed"
has_text "$work/out" "oncall-backup.sh status shows why"
has_text "$work/out" "journalctl --user -u oncall-backup.service"

check "a journal its user cannot read is reported with the fix"
new_checkout volatile-journal
TEST_JOURNAL_UNREADABLE=1 run_setup || fail "exited $?: $(cat "$work/out")"
has_text "$work/out" "$me cannot read its own journal"
has_text "$work/out" "sudo mkdir -p /var/log/journal"

check "a failed check stops before the units are installed"
new_checkout check-fails
TEST_CHECK_FAIL=1 run_setup && fail "succeeded although the check failed"
[ ! -e "$units/oncall-backup.timer" ] || fail "the timer was installed"

check "a % in the checkout path is escaped in the drop-in"
new_checkout 'per%cent'
run_setup --no-first-backup || fail "exited $?: $(cat "$work/out")"
has_line "$units/oncall-backup.service.d/checkout.conf" "WorkingDirectory=${checkout//%/%%}"

if [ "$failures" -ne 0 ]; then
  printf '%s check(s) failed\n' "$failures" >&2
  exit 1
fi
echo "deploy/backup/setup.sh: all checks passed"
