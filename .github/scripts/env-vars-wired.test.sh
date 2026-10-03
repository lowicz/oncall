#!/usr/bin/env bash
# What env-vars-wired.sh accepts as wiring and what it refuses, on small
# Compose files written here.
set -euo pipefail

guard=$(cd "$(dirname "$0")" && pwd)/env-vars-wired.sh
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
echo 'ONCALL_SOLVER_WORKERS=' >"$dir/.env.example"

# check accepted|refused LABEL, with docker-compose.yml on stdin
check() {
  cat >"$dir/docker-compose.yml"
  if output=$("$guard" "$dir" 2>&1); then outcome=accepted; else outcome=refused; fi
  if [ "$outcome" != "$1" ]; then
    echo "FAIL: $2: expected $1, was $outcome" >&2
    echo "$output" >&2
    exit 1
  fi
  if [ "$1" = refused ] && ! grep -q '^  ONCALL_SOLVER_WORKERS$' <<<"$output"; then
    echo "FAIL: $2: the refusal does not name the variable" >&2
    echo "$output" >&2
    exit 1
  fi
  echo "ok: $2"
}

check accepted "an environment entry interpolating the variable" <<'YAML'
services:
  worker:
    environment:
      ONCALL_SOLVER_WORKERS: ${ONCALL_SOLVER_WORKERS:-}
YAML

check accepted "an interpolation outside environment" <<'YAML'
services:
  web:
    ports:
      - "${ONCALL_SOLVER_WORKERS}:8080"
YAML

check accepted "an environment key the file sets itself" <<'YAML'
services:
  worker:
    environment:
      ONCALL_SOLVER_WORKERS: "2"
YAML

check refused "a comment line naming the variable" <<'YAML'
services:
  worker:
    environment:
      # ONCALL_SOLVER_WORKERS remains available in .env as an explicit override.
      ONCALL_SOLVER_LOG: ${ONCALL_SOLVER_LOG:-false}
YAML

check refused "a trailing comment naming the variable" <<'YAML'
services:
  worker:
    environment:
      ONCALL_SOLVER_LOG: ${ONCALL_SOLVER_LOG:-false} # ${ONCALL_SOLVER_WORKERS:-}
YAML

check refused "a longer variable that only starts with the name" <<'YAML'
services:
  worker:
    environment:
      ONCALL_SOLVER_WORKERS_MAX: ${ONCALL_SOLVER_WORKERS_MAX:-8}
YAML

echo "env-vars-wired: all cases passed"
