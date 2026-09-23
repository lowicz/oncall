#!/bin/sh
# Tests for deploy/update.sh: the .env merge, and whole runs against a
# deployment directory with curl, podman and systemctl replaced by stubs that
# log their calls (nothing leaves the temporary directory).
#
#   sh deploy/update.test.sh
set -u

repo_root=$(cd "$(dirname "$0")/.." && pwd -P)
script=$repo_root/deploy/update.sh
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
failures=0
current_test=""

fail() {
  printf 'FAIL %s: %s\n' "$current_test" "$*" >&2
  failures=$((failures + 1))
}

check() {
  current_test=$1
}

has_line() {
  grep -Fqx -- "$2" "$1" || fail "$1 lacks the line: $2"
}

lacks_line() {
  if grep -Fqx -- "$2" "$1"; then
    fail "$1 still has the line: $2"
  fi
}

has_text() {
  grep -Fq -- "$2" "$1" || fail "$1 lacks: $2"
}

same_file() {
  cmp -s "$1" "$2" || fail "$1 differs from $2"
}

mode_of() {
  # shellcheck disable=SC2012 # the permission column is all that is read
  ls -lnd "$1" | cut -c1-10
}

merge() {
  sh "$script" merge-env "$@"
}

# --- .env merge -------------------------------------------------------------

cat >"$work/example" <<'EOF'
# Which release to run.
ONCALL_VERSION=
# Brand, updated comment.
ONCALL_APP_NAME=On-call
ONCALL_APP_SUBTITLE=

# Database.
ONCALL_DATABASE_URL=postgresql+asyncpg://oncall:oncall@db:5432/oncall
# A new setting in this release.
ONCALL_NEW_SETTING=42
# CA bundle, off by default:
# ONCALL_LDAP_CA_FILE=./tls/ca.pem
# Example of an https base URL:
#   ONCALL_PUBLIC_BASE_URL=https://oncall.example:8443
ONCALL_PUBLIC_BASE_URL=http://localhost:8080
POSTGRES_PASSWORD=oncall
EOF

cat >"$work/current" <<'EOF'
# Which release to run (old comment).
ONCALL_VERSION=1.0.0
# Brand.
ONCALL_APP_NAME="Dyżury IT # zespół"
ONCALL_APP_SUBTITLE=
ONCALL_DATABASE_URL=postgresql+asyncpg://oncall:p=ss#w0rd@db:5432/oncall
export ONCALL_PUBLIC_BASE_URL=https://oncall.firma.example:8443
ONCALL_LDAP_CA_FILE=/etc/pki/ad-ca.pem
POSTGRES_PASSWORD='line one
line = two'
# Removed from the example, still set here.
ONCALL_SOLVER_SECONDS=30

# Operator note for a local knob.
LOCAL_KNOB=on
ONCALL_APP_SUBTITLE=Infrastruktura
EOF

check "merge keeps every assigned value verbatim"
merge "$work/current" "$work/example" >"$work/merged" || fail "merge-env exited $?"
has_line "$work/merged" 'ONCALL_VERSION=1.0.0'
has_line "$work/merged" 'ONCALL_APP_NAME="Dyżury IT # zespół"'
has_line "$work/merged" 'ONCALL_DATABASE_URL=postgresql+asyncpg://oncall:p=ss#w0rd@db:5432/oncall'
has_line "$work/merged" 'export ONCALL_PUBLIC_BASE_URL=https://oncall.firma.example:8443'
has_line "$work/merged" "POSTGRES_PASSWORD='line one"
has_line "$work/merged" "line = two'"
has_line "$work/merged" 'ONCALL_SOLVER_SECONDS=30'
has_line "$work/merged" 'LOCAL_KNOB=on'
lacks_line "$work/merged" 'ONCALL_PUBLIC_BASE_URL=http://localhost:8080'
lacks_line "$work/merged" 'POSTGRES_PASSWORD=oncall'
lacks_line "$work/merged" 'ONCALL_APP_NAME=On-call'
grep -v '^#' "$work/current" | grep -v '^$' | sort >"$work/current-lines"
grep -v '^#' "$work/merged" | grep -v '^$' | sort >"$work/merged-lines"
if [ -n "$(comm -23 "$work/current-lines" "$work/merged-lines")" ]; then
  fail "lines of the current .env are missing: $(comm -23 "$work/current-lines" "$work/merged-lines")"
fi

check "merge adds new keys with their example default and comment"
has_line "$work/merged" '# A new setting in this release.'
has_line "$work/merged" 'ONCALL_NEW_SETTING=42'
grep -A1 -Fx '# A new setting in this release.' "$work/merged" | grep -Fqx 'ONCALL_NEW_SETTING=42' ||
  fail "the new key is not under its comment"

check "merge takes comments from the example"
has_line "$work/merged" '# Which release to run.'
has_line "$work/merged" '# Brand, updated comment.'
has_line "$work/merged" '# Database.'
lacks_line "$work/merged" '# Which release to run (old comment).'
lacks_line "$work/merged" '# Brand.'
has_line "$work/merged" '#   ONCALL_PUBLIC_BASE_URL=https://oncall.example:8443'

check "merge puts a key in place of its commented example line"
lacks_line "$work/merged" '# ONCALL_LDAP_CA_FILE=./tls/ca.pem'
grep -A1 -Fx '# CA bundle, off by default:' "$work/merged" | grep -Fqx 'ONCALL_LDAP_CA_FILE=/etc/pki/ad-ca.pem' ||
  fail "ONCALL_LDAP_CA_FILE is not in place of its example line"

check "merge keeps both lines of a key assigned twice, in their order"
grep -A1 -Fx 'ONCALL_APP_SUBTITLE=' "$work/merged" | grep -Fqx 'ONCALL_APP_SUBTITLE=Infrastruktura' ||
  fail "the second ONCALL_APP_SUBTITLE does not follow the first"
[ "$(grep -c '^ONCALL_APP_SUBTITLE=' "$work/merged")" = 2 ] || fail "ONCALL_APP_SUBTITLE is not kept twice"

check "merge keeps unknown keys at the end with the comments above them"
tail -n 6 "$work/merged" >"$work/tail"
cat >"$work/expected-tail" <<'EOF'

# Kept from the previous .env: not in .env.example.
# Removed from the example, still set here.
ONCALL_SOLVER_SECONDS=30
# Operator note for a local knob.
LOCAL_KNOB=on
EOF
cmp -s "$work/tail" "$work/expected-tail" || fail "unexpected end of the merged file: $(cat "$work/tail")"

check "merge is idempotent"
merge "$work/merged" "$work/example" >"$work/merged-again"
same_file "$work/merged-again" "$work/merged"

check "merge with a version changes ONCALL_VERSION only"
merge "$work/current" "$work/example" 2.0.0 >"$work/versioned"
has_line "$work/versioned" 'ONCALL_VERSION=2.0.0'
lacks_line "$work/versioned" 'ONCALL_VERSION=1.0.0'
sed 's/^ONCALL_VERSION=.*/ONCALL_VERSION=1.0.0/' "$work/versioned" | cmp -s - "$work/merged" ||
  fail "the version merge differs from the plain merge in more than ONCALL_VERSION"

check "merge of an empty .env is the example with the version"
: >"$work/empty"
merge "$work/empty" "$work/example" 3.0.0 >"$work/from-empty"
sed 's/^ONCALL_VERSION=$/ONCALL_VERSION=3.0.0/' "$work/example" | cmp -s - "$work/from-empty" ||
  fail "an empty .env does not become the example"

check "merge against the repository .env.example keeps a filled-in .env"
sed -e 's/^ONCALL_VERSION=$/ONCALL_VERSION=0.9.0/' \
  -e 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=f00d/' \
  -e 's/^ONCALL_TLS_CERT_FILE=.*/ONCALL_TLS_CERT_FILE=\/etc\/pki\/cert.pem/' \
  -e 's/^# ONCALL_LDAP_CA_FILE=.*/ONCALL_LDAP_CA_FILE=\/etc\/pki\/ca.pem/' \
  "$repo_root/.env.example" | grep -v '^ONCALL_LDAP_ATTRIBUTE_PHOTO=' >"$work/real-current"
merge "$work/real-current" "$repo_root/.env.example" 1.0.0 >"$work/real-merged"
has_line "$work/real-merged" 'POSTGRES_PASSWORD=f00d'
has_line "$work/real-merged" 'ONCALL_TLS_CERT_FILE=/etc/pki/cert.pem'
has_line "$work/real-merged" 'ONCALL_LDAP_CA_FILE=/etc/pki/ca.pem'
has_line "$work/real-merged" 'ONCALL_LDAP_ATTRIBUTE_PHOTO=thumbnailPhoto'
has_line "$work/real-merged" 'ONCALL_VERSION=1.0.0'
lacks_line "$work/real-merged" '# Kept from the previous .env: not in .env.example.'
[ "$(wc -l <"$work/real-merged")" = "$(wc -l <"$repo_root/.env.example")" ] ||
  fail "the merged file is not line for line the example"

# --- whole runs ---------------------------------------------------------------

stubs=$work/bin
mkdir -p "$stubs"
cat >"$stubs/curl" <<'EOF'
#!/bin/sh
out=""
write=""
url=""
while [ "$#" -gt 0 ]; do
  case $1 in
    -o) out=$2; shift ;;
    -w) write=$2; shift ;;
    -*) ;;
    *) url=$1 ;;
  esac
  shift
done
echo "curl $url" >>"$TEST_LOG"
case $url in
  https://github.com/lowicz/oncall/releases/latest)
    if [ -n "${TEST_LATEST:-}" ]; then
      printf 'https://github.com/lowicz/oncall/releases/tag/v%s' "$TEST_LATEST"
    else
      printf 'https://github.com/lowicz/oncall/releases'
    fi
    ;;
  https://raw.githubusercontent.com/lowicz/oncall/*)
    path=${url#https://raw.githubusercontent.com/lowicz/oncall/}
    [ "${path%%/*}" = "v$TEST_RELEASE" ] || exit 22
    cp "$TEST_SRC/${path#*/}" "$out" || exit 22
    ;;
  *) exit 6 ;;
esac
EOF
cat >"$stubs/podman" <<'EOF'
#!/bin/sh
echo "podman $*" >>"$TEST_LOG"
case $1 in
  pull) exit "${TEST_PULL_FAIL:-0}" ;;
  ps) echo "NAMES IMAGE STATUS" ;;
esac
EOF
cat >"$stubs/systemctl" <<'EOF'
#!/bin/sh
echo "systemctl $*" >>"$TEST_LOG"
[ "$1" = --user ] && shift
case $1 in
  show)
    case $3 in
      LoadState) echo "${TEST_LOAD_STATE:-loaded}" ;;
      WorkingDirectory) echo "$TEST_WORKING_DIRECTORY" ;;
      FragmentPath) echo "$TEST_UNIT_FILE" ;;
    esac
    ;;
  restart) exit "${TEST_RESTART_FAIL:-0}" ;;
esac
EOF
chmod +x "$stubs/curl" "$stubs/podman" "$stubs/systemctl"

# The release the stubs serve: this checkout's files with a new .env.example
# key and a changed unit.
release=$work/release
for file in docker-compose.yml docker-compose.tls.yml docker-compose.ldap-ca.yml .env.example \
  deploy/systemd/oncall.service deploy/systemd/oncall-stack.sh deploy/systemd/install-user-unit.sh; do
  mkdir -p "$release/$(dirname "$file")"
  cp "$repo_root/$file" "$release/$file"
done
printf '# Added in 9.9.9.\nONCALL_ADDED_IN_TEST=yes\n' >>"$release/.env.example"
printf '# Changed in 9.9.9.\n' >>"$release/deploy/systemd/oncall.service"

# A deployment as install-user-unit.sh leaves it, one release behind.
new_deployment() {
  deploy=$work/$1
  rm -rf "$deploy" "${work:?}/home"
  mkdir -p "$deploy/deploy/systemd" "$deploy/tls" "$work/home/.config/systemd/user"
  for file in docker-compose.yml docker-compose.tls.yml docker-compose.ldap-ca.yml .env.example \
    deploy/systemd/oncall.service deploy/systemd/oncall-stack.sh deploy/systemd/install-user-unit.sh; do
    cp "$repo_root/$file" "$deploy/$file"
  done
  printf '# local edit\n' >>"$deploy/docker-compose.tls.yml"
  cp "$repo_root/deploy/systemd/oncall.service" "$work/home/.config/systemd/user/oncall.service"
  echo "certificate" >"$deploy/tls/cert.pem"
  sed -e 's/^ONCALL_VERSION=$/ONCALL_VERSION=1.0.0/' \
    -e 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=f00d/' \
    -e 's/^ONCALL_APP_NAME=.*/ONCALL_APP_NAME="Dyżury"/' "$repo_root/.env.example" >"$deploy/.env"
  chmod 600 "$deploy/.env"
  cp -p "$deploy/.env" "$work/env-before"
  : >"$work/log"
  TEST_WORKING_DIRECTORY=$(cd "$deploy" && pwd -P)
  TEST_UNIT_FILE=$work/home/.config/systemd/user/oncall.service
  export TEST_WORKING_DIRECTORY TEST_UNIT_FILE
}

run_update() {
  PATH="$stubs:$PATH" HOME="$work/home" XDG_RUNTIME_DIR="$work" TEST_LOG="$work/log" \
    TEST_SRC="${TEST_SRC_OVERRIDE:-$release}" TEST_RELEASE=9.9.9 sh "$script" "$@" >"$work/out" 2>&1
}

backups() {
  if [ -d "$deploy/.backup" ]; then
    find "$deploy/.backup" -mindepth 1 -maxdepth 1 | wc -l | tr -d ' '
  else
    echo 0
  fi
}

check "update installs the release, merges .env and restarts the unit"
new_deployment plain
run_update --dir "$deploy" 9.9.9 || fail "exited $?: $(cat "$work/out")"
has_line "$deploy/.env" 'ONCALL_VERSION=9.9.9'
has_line "$deploy/.env" 'POSTGRES_PASSWORD=f00d'
has_line "$deploy/.env" 'ONCALL_APP_NAME="Dyżury"'
has_line "$deploy/.env" 'ONCALL_ADDED_IN_TEST=yes'
has_line "$deploy/.env" '# Added in 9.9.9.'
[ "$(mode_of "$deploy/.env")" = "-rw-------" ] || fail ".env mode is $(mode_of "$deploy/.env")"
for file in docker-compose.yml docker-compose.tls.yml .env.example deploy/systemd/oncall.service; do
  same_file "$deploy/$file" "$release/$file"
done
[ -x "$deploy/deploy/systemd/oncall-stack.sh" ] || fail "oncall-stack.sh lost its executable bit"
has_line "$deploy/tls/cert.pem" certificate
same_file "$TEST_UNIT_FILE" "$release/deploy/systemd/oncall.service"
has_line "$work/log" 'podman pull --quiet ghcr.io/lowicz/oncall-api:9.9.9'
has_line "$work/log" 'podman pull --quiet ghcr.io/lowicz/oncall-web:9.9.9'
has_line "$work/log" 'systemctl --user restart oncall.service'
[ "$(grep -n 'daemon-reload' "$work/log" | cut -d: -f1)" -lt "$(grep -n 'restart' "$work/log" | cut -d: -f1)" ] ||
  fail "daemon-reload does not come before the restart"
has_text "$work/out" 'added ONCALL_ADDED_IN_TEST with the release default'

check "update backs up .env and every replaced file first"
[ "$(backups)" = 1 ] || fail "expected one backup directory, found $(backups)"
backup=$(find "$deploy/.backup" -mindepth 1 -maxdepth 1)
same_file "$backup/.env" "$work/env-before"
[ "$(mode_of "$backup/.env")" = "-rw-------" ] || fail "the .env backup mode is $(mode_of "$backup/.env")"
[ "$(mode_of "$backup")" = "drwx------" ] || fail "the backup directory mode is $(mode_of "$backup")"
tail -n 1 "$backup/docker-compose.tls.yml" | grep -Fqx '# local edit' || fail "the edited compose file was not backed up"
same_file "$backup/unit/oncall.service" "$repo_root/deploy/systemd/oncall.service"
[ ! -e "$backup/docker-compose.yml" ] || fail "an unchanged file was backed up"

check "a second run with the same version changes no file"
cp -p "$deploy/.env" "$work/env-after-first"
: >"$work/log"
run_update --dir "$deploy" 9.9.9 || fail "exited $?: $(cat "$work/out")"
same_file "$deploy/.env" "$work/env-after-first"
[ "$(backups)" = 1 ] || fail "the second run left a backup"
has_text "$work/out" '.env is up to date'
lacks_line "$work/log" 'systemctl --user daemon-reload'
has_line "$work/log" 'systemctl --user restart oncall.service'

check "a release that cannot be pulled changes nothing"
new_deployment pull-fails
TEST_PULL_FAIL=1 run_update --dir "$deploy" 9.9.9 && fail "succeeded although the pull failed"
has_text "$work/out" 'cannot pull ghcr.io/lowicz/oncall-api:9.9.9; nothing was changed'
same_file "$deploy/.env" "$work/env-before"
same_file "$deploy/docker-compose.yml" "$repo_root/docker-compose.yml"
[ "$(backups)" = 0 ] || fail "a backup was made"
lacks_line "$work/log" 'systemctl --user restart oncall.service'

check "a version that is not released changes nothing"
new_deployment missing
run_update --dir "$deploy" 9.9.8 && fail "succeeded for a missing release"
has_text "$work/out" 'cannot download docker-compose.yml of v9.9.8'
same_file "$deploy/.env" "$work/env-before"
lacks_line "$work/log" 'systemctl --user restart oncall.service'

check "without a version the newest stable release is used"
new_deployment latest
TEST_LATEST=9.9.9 run_update --dir "$deploy" || fail "exited $?: $(cat "$work/out")"
has_line "$deploy/.env" 'ONCALL_VERSION=9.9.9'

check "without a version and without a stable release it asks for one"
new_deployment no-stable
run_update --dir "$deploy" && fail "succeeded without a stable release"
has_text "$work/out" 'no stable release is published yet'
same_file "$deploy/.env" "$work/env-before"

check "a v prefix is accepted and garbage is not"
new_deployment prefix
run_update --dir "$deploy" v9.9.9 || fail "exited $?: $(cat "$work/out")"
has_line "$deploy/.env" 'ONCALL_VERSION=9.9.9'
run_update --dir "$deploy" 'latest;rm' && fail "accepted a malformed version"
has_text "$work/out" 'not a release version'

check "missing .env, a foreign unit and an uninstalled unit stop before any change"
new_deployment guards
rm "$deploy/.env"
run_update --dir "$deploy" 9.9.9 && fail "succeeded without .env"
has_text "$work/out" "$TEST_WORKING_DIRECTORY/.env is missing"
new_deployment guards
TEST_WORKING_DIRECTORY=/somewhere/else run_update --dir "$deploy" 9.9.9 && fail "succeeded for another unit directory"
has_text "$work/out" 'oncall.service runs /somewhere/else'
TEST_LOAD_STATE=not-found run_update --dir "$deploy" 9.9.9 && fail "succeeded without the unit"
has_text "$work/out" 'oncall.service is not installed'
run_update --dir "$work/nowhere" 9.9.9 && fail "succeeded for a missing directory"
has_text "$work/out" "$work/nowhere does not exist"
same_file "$deploy/.env" "$work/env-before"
[ "$(backups)" = 0 ] || fail "a backup was made"

check "a failed restart says how to roll back"
new_deployment restart-fails
TEST_RESTART_FAIL=1 run_update --dir "$deploy" 9.9.9 && fail "succeeded although the restart failed"
has_text "$work/out" 'run this script with the previous version (1.0.0)'

check "a release without deploy/systemd keeps the local unit files"
new_deployment old-release
old_release=$work/release-before-systemd
rm -rf "$old_release"
cp -R "$release" "$old_release"
rm -r "$old_release/deploy"
TEST_SRC_OVERRIDE=$old_release run_update --dir "$deploy" 9.9.9 || fail "exited $?: $(cat "$work/out")"
has_text "$work/out" 'v9.9.9 has no deploy/systemd/oncall-stack.sh; keeping the local one'
same_file "$deploy/deploy/systemd/oncall-stack.sh" "$repo_root/deploy/systemd/oncall-stack.sh"
same_file "$deploy/docker-compose.tls.yml" "$release/docker-compose.tls.yml"
has_line "$deploy/.env" 'ONCALL_VERSION=9.9.9'
has_line "$work/log" 'systemctl --user restart oncall.service'

check "ONCALL_DIR names the directory"
new_deployment env-dir
ONCALL_DIR=$deploy run_update 9.9.9 || fail "exited $?: $(cat "$work/out")"
has_line "$deploy/.env" 'ONCALL_VERSION=9.9.9'

check "a git checkout is updated to the tag and stays clean"
origin=$work/origin
rm -rf "$origin"
mkdir -p "$origin"
cp -R "$release/." "$origin/"
cp "$repo_root/.gitignore" "$origin/.gitignore"
git -C "$origin" init -q
git -C "$origin" -c user.name=t -c user.email=t@example.com add -A
git -C "$origin" -c user.name=t -c user.email=t@example.com commit -qm release
git -C "$origin" tag v9.9.9
new_deployment checkout
rm -rf "$deploy"
git clone -q "$origin" "$deploy"
git -C "$deploy" checkout -q --detach HEAD
cp -p "$work/env-before" "$deploy/.env"
TEST_WORKING_DIRECTORY=$(cd "$deploy" && pwd -P)
run_update --dir "$deploy" 9.9.9 || fail "exited $?: $(cat "$work/out")"
[ "$(git -C "$deploy" rev-parse HEAD)" = "$(git -C "$deploy" rev-parse 'v9.9.9^{commit}')" ] || fail "HEAD is not v9.9.9"
has_line "$deploy/.env" 'ONCALL_VERSION=9.9.9'
has_line "$deploy/.env" 'ONCALL_ADDED_IN_TEST=yes'
has_line "$deploy/.env" 'POSTGRES_PASSWORD=f00d'
[ -z "$(git -C "$deploy" status --porcelain)" ] || fail "the checkout is not clean: $(git -C "$deploy" status --porcelain)"
run_update --dir "$deploy" 9.9.7 && fail "succeeded for a tag origin does not have"
has_text "$work/out" 'no tag v9.9.7 in origin'
git -C "$origin" rm -rq deploy
git -C "$origin" -c user.name=t -c user.email=t@example.com commit -qm "before deploy/systemd"
git -C "$origin" tag v0.9.0
run_update --dir "$deploy" 0.9.0 && fail "checked out a release without deploy/systemd"
has_text "$work/out" 'v0.9.0 has no deploy/systemd'
[ "$(git -C "$deploy" rev-parse HEAD)" = "$(git -C "$deploy" rev-parse 'v9.9.9^{commit}')" ] || fail "HEAD moved"

if [ "$failures" -ne 0 ]; then
  printf '%s check(s) failed\n' "$failures" >&2
  exit 1
fi
echo "deploy/update.sh: all checks passed"
