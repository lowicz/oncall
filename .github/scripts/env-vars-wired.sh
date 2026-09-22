#!/usr/bin/env bash
# Every ONCALL_* variable documented in .env.example must be referenced by a
# Compose file, or an operator who sets it in .env finds it silently ignored
# (the api service uses an explicit `environment:` map, not env_file). This
# guards the class of bug behind issues #33/#37, where ONCALL_CORS_ORIGINS was
# documented but never passed to the container.
#
# The check is deliberately textual: a variable name appearing anywhere in any
# docker-compose*.yml (an `environment:` entry, a `${...}` interpolation, a
# port, or a comment marking it an explicit override) counts as wired. It only
# catches a documented variable that appears in no Compose file at all.
set -euo pipefail

cd "$(dirname "$0")/../.."

missing=()
while IFS= read -r var; do
  if ! grep -qF "$var" docker-compose*.yml; then
    missing+=("$var")
  fi
done < <(grep -oE '^ONCALL_[A-Z0-9_]+' .env.example | sort -u)

if [ ${#missing[@]} -gt 0 ]; then
  echo "::error::documented in .env.example but not referenced by any docker-compose*.yml:" >&2
  printf '  %s\n' "${missing[@]}" >&2
  echo "Wire each variable into a service (or remove it from .env.example if it is not a real setting)." >&2
  exit 1
fi

echo "env vars: every ONCALL_* in .env.example is referenced by a Compose file"
