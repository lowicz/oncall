#!/usr/bin/env bash
# Every ONCALL_* variable documented in .env.example must be wired into a
# Compose file, or an operator who sets it in .env finds it silently ignored
# (the services use an explicit `environment:` map, not env_file). This guards
# the class of bug behind issues #33/#37, where ONCALL_CORS_ORIGINS was
# documented but never passed to the container.
#
# Wired means one of two shapes in any docker-compose*.yml, comments removed:
# a `${VAR...}` interpolation (an environment value, a port, an image tag, a
# mount) or an `environment:` key set by the file itself. A name that only a
# comment mentions is not wired.
#
# Usage: env-vars-wired.sh [DIRECTORY]   (default: the repository root)
set -euo pipefail

cd "${1:-$(dirname "$0")/../..}"

wiring=$(sed -E 's/(^|[[:space:]])#.*$//' docker-compose*.yml)

missing=()
while IFS= read -r var; do
  if ! grep -qE "\\\$\\{${var}[^A-Z0-9_]|^[[:space:]]+(- )?${var}[:=]" <<<"$wiring"; then
    missing+=("$var")
  fi
done < <(grep -oE '^ONCALL_[A-Z0-9_]+' .env.example | sort -u)

if [ ${#missing[@]} -gt 0 ]; then
  echo "::error::documented in .env.example but not wired into any docker-compose*.yml:" >&2
  printf '  %s\n' "${missing[@]}" >&2
  echo "Wire each variable into a service (or remove it from .env.example if it is not a real setting)." >&2
  exit 1
fi

echo "env vars: every ONCALL_* in .env.example is wired into a Compose file"
