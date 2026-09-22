#!/usr/bin/env bash
# The user systemd unit must stay a path-free oneshot that calls
# oncall-stack.sh. Compose files remain the stack definition (not Quadlet,
# not a pasted podman compose line). down must not delete volumes.
set -euo pipefail

cd "$(dirname "$0")/../.."

unit=deploy/systemd/oncall.service
stack=deploy/systemd/oncall-stack.sh
install=deploy/systemd/install-user-unit.sh
failed=0

present() {
  local label=$1 file=$2 pattern=$3
  if grep -Eq -- "$pattern" "$file"; then
    return 0
  fi
  echo "::error::$label" >&2
  failed=1
}

absent() {
  local label=$1 file=$2 pattern=$3
  if grep -Eq -- "$pattern" "$file"; then
    echo "::error::$label" >&2
    failed=1
  fi
}

present "$unit: Type=oneshot" "$unit" '^Type=oneshot$'
present "$unit: RemainAfterExit=yes" "$unit" '^RemainAfterExit=yes$'
present "$unit: WantedBy=default.target" "$unit" '^WantedBy=default.target$'
present "$unit: starts oncall-stack.sh up" "$unit" 'oncall-stack\.sh up'
present "$unit: stops oncall-stack.sh down" "$unit" 'oncall-stack\.sh down'
absent "$unit: does not paste podman compose" "$unit" 'podman compose'
absent "$unit: does not set WorkingDirectory" "$unit" '^WorkingDirectory='
absent "$unit: does not load EnvironmentFile" "$unit" '^EnvironmentFile='
absent "$unit: is not a system service" "$unit" 'multi-user\.target'

present "$stack: default is the three production files" "$stack" \
  'docker-compose\.yml docker-compose\.tls\.yml docker-compose\.ldap-ca\.yml'
present "$stack: down is compose down" "$stack" 'compose_action=\(down\)'
absent "$stack: down does not pass --volumes" "$stack" '--volumes|down -v'
absent "$stack: does not source .env" "$stack" '(^|[[:space:]])(\.|source)[[:space:]]+[^[:space:]]*\.env'
absent "$install: does not source .env" "$install" '(^|[[:space:]])(\.|source)[[:space:]]+[^[:space:]]*\.env'

bash -n "$stack"
bash -n "$install"

if [ "$failed" -ne 0 ]; then
  echo "Keep the user unit as a oneshot that calls oncall-stack.sh; do not paste compose into the unit or delete volumes on stop." >&2
  exit 1
fi
echo "systemd user unit: oneshot calls oncall-stack.sh; production path is the three compose files"
