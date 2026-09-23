#!/usr/bin/env bash
# Every service runs on a read-only root filesystem, with every Linux
# capability dropped and no-new-privileges set; only the database adds a few
# capabilities back, for the entrypoint that prepares its data directory
# (issue #34). Checked on the resolved configuration of the production file
# alone and with each overlay, so neither docker-compose.yml nor an overlay can
# quietly hand a service a writable root filesystem or its default capabilities.
# The database publishes no port either: its password is a local default until
# the operator replaces it, so it stays reachable only on the Compose network
# (docs/wdrozenie/uruchomienie.md, "Granica zaufania", issue #79).
set -euo pipefail

cd "$(dirname "$0")/../.."

combinations=(
  "docker-compose.yml"
  "docker-compose.yml docker-compose.tls.yml"
  "docker-compose.yml docker-compose.ldap-ca.yml"
  "docker-compose.yml docker-compose.tls.yml docker-compose.ldap-ca.yml"
  "docker-compose.yml docker-compose.dev.yml"
  "docker-compose.yml docker-compose.dev.yml docker-compose.tls.yml"
)

# One line per shortfall, "<service>: <what>". The $names are jq's, not the
# shell's.
# shellcheck disable=SC2016
check='
  .services | to_entries[] | .key as $name | .value |
  (if .read_only != true then "\($name): read_only is not true" else empty end),
  (if (.cap_drop // []) != ["ALL"] then "\($name): cap_drop is not [ALL]" else empty end),
  (if $name != "db" and (.cap_add // []) != [] then "\($name): adds capabilities back" else empty end),
  (if $name == "db" and (.ports // []) != [] then "\($name): publishes a port to the host" else empty end),
  (if (.security_opt // []) | any(. == "no-new-privileges:true") | not
   then "\($name): security_opt lacks no-new-privileges:true" else empty end)
'

failed=0
for files in "${combinations[@]}"; do
  args=()
  for file in $files; do args+=(-f "$file"); done
  problems=$(docker compose "${args[@]}" config --format json | jq -r "$check")
  if [ -n "$problems" ]; then
    echo "::error::${files// / + }: a service is not hardened" >&2
    printf '  %s\n' "$problems" >&2
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  echo "Keep read_only: true, cap_drop: [ALL] and no-new-privileges:true on every service, and no ports on db (docker-compose.yml)." >&2
  exit 1
fi
echo "compose hardening: every service is read-only, drops all capabilities and sets no-new-privileges; db publishes no port"
