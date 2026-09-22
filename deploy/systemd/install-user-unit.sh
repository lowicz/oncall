#!/usr/bin/env bash
# Install the On-call user systemd unit for the Podman Compose stack.
# Idempotent: copies the unit, writes WorkingDirectory as a drop-in, enables
# linger, then enables and starts podman.socket and the unit.
#
# Usage: install-user-unit.sh CHECKOUT_DIR [compose-file ...]
# CHECKOUT_DIR is the deploy checkout (compose files and .env). It is not
# guessed from the home directory. With no compose-file arguments the shipped
# production path is all three files. Extra names omit an overlay without
# editing the unit (written as ONCALL_COMPOSE_FILES on the drop-in).
# The script does not read .env.
set -euo pipefail

usage() {
  echo "usage: $0 CHECKOUT_DIR [compose-file ...]" >&2
  echo "CHECKOUT_DIR is the deploy checkout with docker-compose.yml and .env." >&2
  echo "Optional compose-file names (in that checkout) omit an overlay." >&2
  echo "Run as the deployment user, not root." >&2
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi
if [ "$#" -lt 1 ]; then
  usage
  exit 2
fi

if [ "$(id -u)" -eq 0 ]; then
  echo "error: run as the deployment user, not root" >&2
  exit 1
fi

if [ -z "${HOME:-}" ]; then
  echo "error: HOME is not set" >&2
  exit 1
fi

if [ ! -d "$1" ]; then
  echo "error: not a directory: $1" >&2
  exit 1
fi

checkout=$(cd "$1" && pwd -P)
shift
case $checkout in
  *$'\n'* | *$'\r'*)
    echo "error: checkout path contains a newline" >&2
    exit 1
    ;;
esac

unit_src=$checkout/deploy/systemd/oncall.service
stack_src=$checkout/deploy/systemd/oncall-stack.sh
if [ ! -f "$unit_src" ]; then
  echo "error: missing $unit_src" >&2
  exit 1
fi
if [ ! -f "$stack_src" ]; then
  echo "error: missing $stack_src" >&2
  exit 1
fi
if [ ! -f "$checkout/.env" ]; then
  echo "error: missing $checkout/.env (compose reads it from the checkout)" >&2
  exit 1
fi

compose_files=()
if [ "$#" -eq 0 ]; then
  compose_files=(docker-compose.yml docker-compose.tls.yml docker-compose.ldap-ca.yml)
else
  for file in "$@"; do
    case $file in
      */*|-*|'')
        echo "error: compose file must be a name in the checkout: $file" >&2
        exit 1
        ;;
    esac
    compose_files+=("$file")
  done
fi
for file in "${compose_files[@]}"; do
  if [ ! -f "$checkout/$file" ]; then
    echo "error: missing $checkout/$file" >&2
    exit 1
  fi
done

for cmd in systemctl loginctl; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "error: $cmd not found" >&2
    exit 1
  fi
done

config_home=${XDG_CONFIG_HOME:-$HOME/.config}
unit_dir=$config_home/systemd/user
drop_in_dir=$unit_dir/oncall.service.d
working_directory=${checkout//'%'/'%%'}

install -D -m 644 "$unit_src" "$unit_dir/oncall.service"
install -d -m 755 "$drop_in_dir"

{
  printf '[Service]\n'
  printf 'WorkingDirectory=%s\n' "$working_directory"
  if [ "$#" -gt 0 ]; then
    joined=$(printf '%s:' "${compose_files[@]}")
    printf 'Environment=ONCALL_COMPOSE_FILES=%s\n' "${joined%:}"
  fi
} > "$drop_in_dir/checkout.conf"
chmod 644 "$drop_in_dir/checkout.conf"

user=$(id -un)
loginctl enable-linger "$user"

systemctl --user daemon-reload
systemctl --user enable --now podman.socket
systemctl --user enable --now oncall.service
