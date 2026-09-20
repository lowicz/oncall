#!/bin/bash
# usage: stats_sampler.sh OUTFILE  (runs until killed)
while true; do docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}}' | sed "s/^/$(date +%s),/"; done > "$1"
