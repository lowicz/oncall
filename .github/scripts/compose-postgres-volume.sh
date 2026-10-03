#!/usr/bin/env bash
# The PostgreSQL data volume is named after the major version of the image
# (oncall-postgres-<major>). A new major is a data move, not a tag change
# alone: deploy/update.sh runs upgrade-postgres, which starts the release's
# db service on the volume the Compose file declares, and refuses a volume
# that already exists. Renovate moves the image tag and the volume name
# together (renovate.json5, the PostgreSQL group); this check keeps a hand
# edit or a split update from shipping one without the other.
#
# The image names one PostgreSQL release (postgres:<major>.<minor>-alpine),
# never a floating tag, and the contract Compose file and the CI service run
# that same release: what CI tested is what a host runs.
set -euo pipefail

cd "$(dirname "$0")/../.."

file=docker-compose.yml

image_line=$(grep -E '^[[:space:]]*image:[[:space:]]*postgres:[0-9]+' "$file" || true)
case $image_line in
  '')
    echo "::error::$file has no postgres:<major> image line for the db service" >&2
    exit 1
    ;;
  *$'\n'*)
    echo "::error::$file names more than one postgres image: $image_line" >&2
    exit 1
    ;;
esac
image=${image_line#*image:}
image=${image//[[:space:]]/}
if ! [[ $image =~ ^postgres:[0-9]+\.[0-9]+-alpine$ ]]; then
  echo "::error::$file: the db image is $image; name one release, postgres:<major>.<minor>-alpine" >&2
  exit 1
fi
image_major=${image#postgres:}
image_major=${image_major%%.*}

for other in docker-compose.contract.yml .github/workflows/ci.yml; do
  others=$({ grep -E '^[[:space:]]*image:[[:space:]]*postgres:' "$other" || true; } | sed -E 's/^[[:space:]]*image:[[:space:]]*//' | sort -u | paste -sd ' ' -)
  if [ "$others" != "$image" ]; then
    echo "::error::$other runs ${others:-no postgres image} but $file runs $image; keep them on one release" >&2
    exit 1
  fi
done

mounts=$(grep -E '^[[:space:]]*-[[:space:]]*oncall-postgres-[0-9]+:' "$file" || true)
decls=$(grep -E '^[[:space:]]*oncall-postgres-[0-9]+:[[:space:]]*$' "$file" || true)

if [ -z "$mounts" ] || [ -z "$decls" ]; then
  echo "::error::$file must mount and declare oncall-postgres-<major> for the db data directory" >&2
  exit 1
fi

majors=$(printf '%s\n%s\n' "$mounts" "$decls" | sed -E 's/.*oncall-postgres-([0-9]+).*/\1/' | sort -u)
case $majors in
  *$'\n'*)
    echo "::error::$file names more than one oncall-postgres-* major:" >&2
    printf '  %s\n' "$majors" >&2
    exit 1
    ;;
esac

if [ "$majors" != "$image_major" ]; then
  echo "::error::$file: postgres image major is $image_major but the data volume is oncall-postgres-$majors" >&2
  echo "Keep them equal: Renovate's PostgreSQL group moves both (renovate.json5), and a major bump must mount a fresh volume." >&2
  exit 1
fi

echo "compose postgres volume: oncall-postgres-$image_major matches $image, as do docker-compose.contract.yml and ci.yml"
