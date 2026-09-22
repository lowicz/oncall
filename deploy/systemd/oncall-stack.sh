#!/usr/bin/env bash
# Single entry point for the On-call Podman Compose stack.
# The user systemd unit calls this with `up` or `down` from the checkout
# (WorkingDirectory). Compose files stay the stack definition; this script
# does not duplicate them as Quadlet.
#
# The shipped production path starts all three files. A host that does not
# need an overlay sets ONCALL_COMPOSE_FILES (colon-separated, relative to
# the checkout) in the systemd drop-in - not by editing the unit. This
# script does not read .env; compose reads it from the working directory.
set -euo pipefail

usage() {
  echo "usage: $0 up|down" >&2
  echo "Run from the deploy checkout. down does not delete volumes." >&2
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi
if [ "$#" -ne 1 ]; then
  usage
  exit 2
fi

case $1 in
  up) compose_action=(up -d) ;;
  down) compose_action=(down) ;;
  *)
    usage
    exit 2
    ;;
esac

if [ ! -f docker-compose.yml ]; then
  echo "error: docker-compose.yml not in the working directory" >&2
  exit 1
fi
if [ ! -f .env ]; then
  echo "error: .env is missing in the working directory (compose reads it here)" >&2
  exit 1
fi

default_files=(docker-compose.yml docker-compose.tls.yml docker-compose.ldap-ca.yml)
compose_files=()
if [ -n "${ONCALL_COMPOSE_FILES:-}" ]; then
  IFS=':' read -r -a compose_files <<< "$ONCALL_COMPOSE_FILES"
else
  compose_files=("${default_files[@]}")
fi

args=()
for file in "${compose_files[@]}"; do
  if [ -z "$file" ]; then
    continue
  fi
  case $file in
    */*|-* )
      echo "error: compose file must be a name in the checkout: $file" >&2
      exit 1
      ;;
  esac
  if [ ! -f "$file" ]; then
    echo "error: missing $file" >&2
    exit 1
  fi
  args+=(-f "$file")
done
if [ "${#args[@]}" -eq 0 ]; then
  echo "error: no compose files" >&2
  exit 1
fi

if ! command -v podman >/dev/null 2>&1; then
  echo "error: podman not found" >&2
  exit 1
fi

exec podman compose "${args[@]}" "${compose_action[@]}"
