#!/usr/bin/env bash
# The development overlay may only replace `image:` with a local `build:`.
# Every environment variable, healthcheck, volume, port, limit and dependency
# must stay the production file's, so a developer runs what production runs.
# Compared on the resolved configuration, so a change to either file that
# breaks that parity fails here rather than on somebody's laptop.
set -euo pipefail

strip='del(.services[].image, .services[].build, .services[].pull_policy)'
production=$(docker compose -f docker-compose.yml config --format json | jq -S "$strip")
development=$(docker compose -f docker-compose.yml -f docker-compose.dev.yml config --format json | jq -S "$strip")

if ! diff <(echo "$production") <(echo "$development"); then
  echo "::error::docker-compose.dev.yml changes more than image/build (see the diff above)" >&2
  exit 1
fi
echo "compose parity: the development overlay only swaps image for build"
