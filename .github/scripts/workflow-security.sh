#!/usr/bin/env bash
# The workflow files keep the supply-chain rules the repository relies on:
#   - every external action is pinned to a full commit SHA with its version
#     as a comment, the form Renovate moves forward (renovate.json5);
#   - every workflow declares its top-level token permissions, so no job
#     silently inherits the repository default;
#   - there is no Dependabot version-update configuration: Renovate is the
#     only bot that opens update pull requests, and Dependabot stays the
#     source of security alerts (docs/wdrozenie/wydania.md).
set -euo pipefail

status=0

while IFS= read -r line; do
  file=${line%%:*}
  rest=${line#*:}
  number=${rest%%:*}
  ref=$(sed -E 's/^[[:space:]-]*uses:[[:space:]]*//; s/[[:space:]]+$//' <<< "${rest#*:}")
  case $ref in
    ./* | docker://*) continue ;;
  esac
  if [[ ! $ref =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_./-]+@[0-9a-f]{40}[[:space:]]+#[[:space:]]+v[0-9][^[:space:]]*$ ]]; then
    echo "::error file=$file,line=$number::action not pinned to a full commit SHA with a version comment: $ref" >&2
    status=1
  fi
done < <(grep -HnE '^[[:space:]-]*uses:' .github/workflows/*.yml)

for file in .github/workflows/*.yml; do
  if ! grep -qE '^permissions:' "$file"; then
    echo "::error file=$file::no top-level permissions block" >&2
    status=1
  fi
done

for file in .github/dependabot.yml .github/dependabot.yaml; do
  if [ -e "$file" ]; then
    echo "::error file=$file::Renovate is the only update bot; Dependabot is kept for security alerts only" >&2
    status=1
  fi
done

if [ "$status" = 0 ]; then
  echo "workflow security: actions pinned to SHAs, permissions declared, no Dependabot updates"
fi
exit "$status"
