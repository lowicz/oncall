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

compose_config() {
  local compose_file=$1
  ONCALL_VERSION=${ONCALL_VERSION:-0.0.0-compose-check} docker compose -f "$compose_file" config --format json
}

compose_service_image() {
  local compose_file=$1
  local service=$2

  compose_config "$compose_file" | python3 -c '
import json
import sys

compose_file, service = sys.argv[1:]
data = json.load(sys.stdin)
try:
    image = data["services"][service]["image"]
except KeyError:
    print(f"::error::{compose_file} has no {service} service image", file=sys.stderr)
    sys.exit(1)
if not isinstance(image, str) or not image:
    print(f"::error::{compose_file} {service} service image is empty", file=sys.stderr)
    sys.exit(1)
print(image)
' "$compose_file" "$service"
}

workflow_service_image() {
  local workflow=$1
  local job=$2
  local service=$3

  ruby -ryaml -e '
path, job, service = ARGV
begin
  begin
    data = YAML.safe_load_file(path, aliases: true)
  rescue ArgumentError
    data = YAML.load_file(path)
  end
  image = data.fetch("jobs").fetch(job).fetch("services").fetch(service).fetch("image")
rescue KeyError
  abort "::error::#{path} has no #{job}.services.#{service}.image"
end
unless image.is_a?(String) && !image.empty?
  abort "::error::#{path} #{job}.services.#{service}.image is empty"
end
puts image
' "$workflow" "$job" "$service"
}

compose_postgres_volume_majors() {
  local compose_file=$1
  local service=$2

  compose_config "$compose_file" | python3 -c '
import json
import re
import sys

compose_file, service = sys.argv[1:]
data = json.load(sys.stdin)
try:
    service_volumes = data["services"][service].get("volumes", [])
except KeyError:
    print(f"::error::{compose_file} has no {service} service", file=sys.stderr)
    sys.exit(1)
mounted = {
    volume.get("source", "")
    for volume in service_volumes
    if volume.get("type") == "volume" and re.fullmatch(r"oncall-postgres-[0-9]+", volume.get("source", ""))
}
declared = {
    name
    for name in data.get("volumes", {})
    if re.fullmatch(r"oncall-postgres-[0-9]+", name)
}
if not mounted or not declared:
    print(f"::error::{compose_file} must mount and declare oncall-postgres-<major> for the db data directory", file=sys.stderr)
    sys.exit(1)
majors = sorted({name.rsplit("-", 1)[1] for name in mounted | declared})
print("\n".join(majors))
' "$compose_file" "$service"
}

image=$(compose_service_image "$file" db)
if ! [[ $image =~ ^postgres:[0-9]+\.[0-9]+-alpine$ ]]; then
  echo "::error::$file: the db image is $image; name one release, postgres:<major>.<minor>-alpine" >&2
  exit 1
fi
image_major=${image#postgres:}
image_major=${image_major%%.*}

contract_image=$(compose_service_image docker-compose.contract.yml contract-db)
ci_image=$(workflow_service_image .github/workflows/ci.yml backend-postgres postgres)
for other in "docker-compose.contract.yml:$contract_image" ".github/workflows/ci.yml:$ci_image"; do
  other_file=${other%%:*}
  other_image=${other#*:}
  if [ "$other_image" != "$image" ]; then
    echo "::error::$other_file runs ${other_image:-no postgres image} but $file runs $image; keep them on one release" >&2
    exit 1
  fi
done

majors=$(compose_postgres_volume_majors "$file" db)
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
