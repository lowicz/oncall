#!/bin/sh
set -eu

alembic upgrade head
python -m oncall.seed_admin

if [ -n "${ONCALL_API_WORKERS:-}" ]; then
    workers="$ONCALL_API_WORKERS"
else
    workers="$(python -c 'from oncall.config import available_cpu_count; print(max(2, available_cpu_count()))')"
fi

case "$workers" in
    ''|*[!0-9]*) echo "ONCALL_API_WORKERS must be a positive integer" >&2; exit 2 ;;
esac
if [ "$workers" -lt 1 ]; then
    echo "ONCALL_API_WORKERS must be a positive integer" >&2
    exit 2
fi

exec uvicorn oncall.main:app --host 0.0.0.0 --port 8000 --workers "$workers"
