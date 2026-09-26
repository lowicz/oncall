#!/usr/bin/env bash
# Installs the daily database backups for the deployment this checkout runs:
# writes the settings, creates the backup directory, installs the user units,
# enables the timer and takes the first backup, proved by a restore.
# Idempotent: run it again to change a setting; what is not given stays.
#
#   deploy/backup/setup.sh [--owner USER] [--backup-dir DIR] [--keep N]
#                          [--alert-email ADDRESS[,ADDRESS...]] [--backup-time HH:MM]
#                          [--no-first-backup]
#
# Run it as the user whose systemd runs oncall.service (production: podman),
# logged in directly (ssh podman@host or machinectl shell podman@), not root
# and not through su or sudo. That user owns the backup directory and runs the
# timer; rootless Podman keeps the containers per user, so nobody else can.
# Guide: docs/wdrozenie/kopie-zapasowe.md.
set -euo pipefail

usage() {
  cat <<'EOF'
usage: setup.sh [--owner USER] [--backup-dir DIR] [--keep N]
                [--alert-email ADDRESS[,ADDRESS...]] [--backup-time HH:MM]
                [--no-first-backup]

  --owner USER         assert the user that owns the backups (default: you;
                       it must be the user whose systemd runs oncall.service)
  --backup-dir DIR     where the backups go (default ~/oncall-backups)
  --keep N             how many backups to keep (default 30)
  --alert-email LIST   who gets the failure e-mail (default: the active
                       administrators' addresses in the application)
  --backup-time HH:MM  when the daily backup starts, in the host's time zone,
                       up to 15 minutes later (default 21:00)
  --no-first-backup    install without taking a backup now

Values not given keep what the last run wrote.
EOF
}

say() {
  printf '%s\n' "$*"
}

die() {
  printf 'error: %s\n' "$*" >&2
  exit 1
}

need_cmd() {
  local cmd
  for cmd in "$@"; do
    command -v "$cmd" >/dev/null 2>&1 || die "$cmd not found; install it and run again"
  done
}

# The last value the settings file gives KEY, if any.
setting() {
  [ -f "$config" ] || return 0
  sed -n "s/^$1=//p" "$config" | tail -n 1
}

main() {
  local owner_flag="" dir_flag="" keep_flag="" alert_flag="" time_flag="" first_backup=true
  while [ "$#" -gt 0 ]; do
    case $1 in
      -h | --help)
        usage
        return 0
        ;;
      --owner | --backup-dir | --keep | --alert-email | --backup-time)
        [ "$#" -ge 2 ] || die "$1 needs a value"
        case $1 in
          --owner) owner_flag=$2 ;;
          --backup-dir) dir_flag=$2 ;;
          --keep) keep_flag=$2 ;;
          --alert-email) alert_flag=$2 ;;
          --backup-time) time_flag=$2 ;;
        esac
        shift 2
        ;;
      --no-first-backup)
        first_backup=false
        shift
        ;;
      *)
        usage >&2
        return 2
        ;;
    esac
  done

  local user
  user=$(id -un)
  [ "$(id -u)" -ne 0 ] || die "run as the deployment user (e.g. podman), not root"
  [ -n "${HOME:-}" ] || die "HOME is not set"
  if [ -n "$owner_flag" ] && [ "$owner_flag" != "$user" ]; then
    die "the backups are to belong to $owner_flag; log in as $owner_flag (ssh $owner_flag@host or machinectl shell $owner_flag@) and run this again"
  fi
  need_cmd systemctl loginctl journalctl podman flock install sed paste stat

  local here checkout script
  here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
  checkout=$(cd "$here/../.." && pwd -P)
  script=$here/oncall-backup.sh
  local unit
  for unit in oncall-backup.sh oncall-backup.service oncall-backup-alert.service oncall-backup.timer; do
    [ -f "$here/$unit" ] || die "missing $here/$unit"
  done
  [ -f "$checkout/docker-compose.yml" ] || die "$checkout has no docker-compose.yml"

  if [ -z "${XDG_RUNTIME_DIR:-}" ] && [ -d "/run/user/$(id -u)" ]; then
    XDG_RUNTIME_DIR=/run/user/$(id -u)
    export XDG_RUNTIME_DIR
  fi
  systemctl --user show-environment >/dev/null 2>&1 ||
    die "cannot reach your systemd user manager; log in as $user directly (ssh or machinectl shell $user@), not with su or sudo"

  # The backups belong to the user who runs the stack, and to nobody else.
  [ "$(systemctl --user show -p LoadState --value oncall.service)" = loaded ] ||
    die "oncall.service is not installed for $user. Backups run as the user whose systemd runs the stack: log in as that user, or install the stack first (docs/wdrozenie/systemd.md)"
  local stack_dir
  stack_dir=$(systemctl --user show -p WorkingDirectory --value oncall.service)
  if [ -d "$stack_dir" ]; then
    stack_dir=$(cd "$stack_dir" && pwd -P)
  fi
  [ "$stack_dir" = "$checkout" ] ||
    die "oncall.service of $user runs ${stack_dir:-no directory}, not $checkout; run the setup of that checkout"

  # Without linger the user's systemd, and with it the timer, stops at logout.
  if [ "$(loginctl show-user "$user" --property=Linger --value 2>/dev/null)" != yes ]; then
    loginctl enable-linger "$user" 2>/dev/null || true
    [ "$(loginctl show-user "$user" --property=Linger --value 2>/dev/null)" = yes ] ||
      die "linger is off for $user, so the timer would stop at logout; ask an administrator to run: sudo loginctl enable-linger $user"
  fi

  config=${XDG_CONFIG_HOME:-$HOME/.config}/oncall/backup.conf
  local configured_owner
  configured_owner=$(setting ONCALL_BACKUP_OWNER)
  if [ -n "$configured_owner" ] && [ "$configured_owner" != "$user" ]; then
    die "$config says the backups belong to $configured_owner; run this as $configured_owner"
  fi

  local backup_dir keep alert backup_time wait
  backup_dir=${dir_flag:-$(setting ONCALL_BACKUP_DIR)}
  backup_dir=${backup_dir:-$HOME/oncall-backups}
  keep=${keep_flag:-$(setting ONCALL_BACKUP_KEEP)}
  keep=${keep:-30}
  alert=${alert_flag:-$(setting ONCALL_BACKUP_ALERT_EMAIL)}
  backup_time=${time_flag:-$(setting ONCALL_BACKUP_TIME)}
  backup_time=${backup_time:-21:00}
  wait=$(setting ONCALL_BACKUP_WAIT_SECONDS)

  case $backup_dir in
    /*) ;;
    *) die "--backup-dir must be an absolute path: $backup_dir" ;;
  esac
  case $backup_dir in
    *$'\n'*) die "--backup-dir cannot contain a newline" ;;
  esac
  backup_dir=${backup_dir%/}
  case $backup_dir/ in
    "$checkout"/*) die "$backup_dir is inside the deployment checkout; keep the backups outside it, e.g. $HOME/oncall-backups" ;;
  esac
  case $keep in
    '' | *[!0-9]* | 0*) die "--keep must be a whole number of at least 1: $keep" ;;
  esac
  [[ $backup_time =~ ^([01]?[0-9]|2[0-3]):([0-5][0-9])$ ]] ||
    die "--backup-time must be an hour and minute, HH:MM between 00:00 and 23:59: $backup_time"
  backup_time=$(printf '%02d:%s' "$((10#${BASH_REMATCH[1]}))" "${BASH_REMATCH[2]}")

  if [ -z "$alert" ]; then
    say "Looking up the administrators' e-mail addresses for failure alerts"
    alert=$(ONCALL_BACKUP_DIR=$backup_dir bash "$script" admin-emails | paste -sd, -) ||
      die "cannot read the administrators' addresses from the database; pass --alert-email ADDRESS"
    [ -n "$alert" ] || die "no active administrator has an e-mail address; pass --alert-email ADDRESS"
  fi
  alert=$(printf '%s' "$alert" | tr -d ' ')
  local address
  for address in ${alert//,/ }; do
    [[ $address =~ ^[^@[:space:]]+@[^@[:space:]]+$ ]] || die "not an e-mail address: $address"
  done

  # The directory: the owner's, closed to everyone else.
  if [ -e "$backup_dir" ]; then
    [ -d "$backup_dir" ] || die "$backup_dir exists and is not a directory"
    [ "$(stat -c %u "$backup_dir")" = "$(id -u)" ] ||
      die "$backup_dir belongs to $(stat -c %U "$backup_dir"), not $user; an administrator can hand it over: sudo chown $user: $backup_dir"
  else
    mkdir -p -- "$backup_dir"
    say "Created $backup_dir"
  fi
  chmod 700 "$backup_dir"

  mkdir -p "$(dirname "$config")"
  local tmp=$config.new.$$
  (
    umask 077
    {
      printf '# On-call database backups, written by deploy/backup/setup.sh.\n'
      printf '# Read by deploy/backup/oncall-backup.sh at every run; see docs/wdrozenie/kopie-zapasowe.md.\n'
      printf 'ONCALL_BACKUP_OWNER=%s\n' "$user"
      printf 'ONCALL_BACKUP_DIR=%s\n' "$backup_dir"
      printf 'ONCALL_BACKUP_KEEP=%s\n' "$keep"
      printf 'ONCALL_BACKUP_ALERT_EMAIL=%s\n' "$alert"
      printf 'ONCALL_BACKUP_TIME=%s\n' "$backup_time"
      if [ -n "$wait" ]; then
        printf 'ONCALL_BACKUP_WAIT_SECONDS=%s\n' "$wait"
      fi
    } >"$tmp"
  )
  mv -f "$tmp" "$config"
  say "Settings: $config"

  bash "$script" check

  local unit_dir working_directory name
  unit_dir=${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user
  working_directory=${checkout//'%'/'%%'}
  for name in oncall-backup.service oncall-backup-alert.service oncall-backup.timer; do
    install -D -m 644 "$here/$name" "$unit_dir/$name"
  done
  for name in oncall-backup.service oncall-backup-alert.service; do
    install -d -m 755 "$unit_dir/$name.d"
    printf '[Service]\nWorkingDirectory=%s\n' "$working_directory" >"$unit_dir/$name.d/checkout.conf"
    chmod 644 "$unit_dir/$name.d/checkout.conf"
  done
  # The time is this host's, so it lives in a drop-in: update.sh refreshes the
  # timer unit itself from each release and never touches drop-ins.
  install -d -m 755 "$unit_dir/oncall-backup.timer.d"
  printf '# Written by deploy/backup/setup.sh from ONCALL_BACKUP_TIME; change it with setup.sh --backup-time.\n[Timer]\nOnCalendar=\nOnCalendar=*-*-* %s:00\n' \
    "$backup_time" >"$unit_dir/oncall-backup.timer.d/time.conf"
  chmod 644 "$unit_dir/oncall-backup.timer.d/time.conf"
  systemctl --user daemon-reload
  systemctl --user enable oncall-backup.timer
  # Restarted so a changed time takes effect now.
  systemctl --user restart oncall-backup.timer
  say "Installed the units in $unit_dir; oncall-backup.timer runs daily at $backup_time"

  if [ "$first_backup" = true ]; then
    say "Taking a backup the way the timer does (systemctl --user start oncall-backup.service)"
    systemctl --user start oncall-backup.service ||
      die "the backup failed; $script status shows why and journalctl --user -u oncall-backup.service has its log. The failure alert went to $alert"
  fi

  # The runbook reads the backup log with journalctl --user, which fails when
  # the journal is kept only in memory (no /var/log/journal): its user cannot
  # read it, and it is gone after a reboot.
  if ! journalctl --user --quiet --lines 0 >/dev/null 2>&1; then
    say ""
    say "Note: $user cannot read its own journal (journalctl --user), so the backup log is visible to administrators only and lost at reboot; $script status still shows the last failure. To keep the journal on disk, where every user reads their own, an administrator runs:"
    say "  sudo mkdir -p /var/log/journal && sudo systemd-tmpfiles --create --prefix /var/log/journal && sudo systemctl restart systemd-journald"
  fi

  say ""
  bash "$script" status
  say ""
  say "Backups belong to $user and go to $backup_dir daily at $backup_time; the newest $keep are kept; failures are e-mailed to $alert."
}

config=""
main "$@"
