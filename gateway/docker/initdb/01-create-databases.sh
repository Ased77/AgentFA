#!/bin/sh
# Creates the two databases inside the single postgres instance:
#   litellm  -> LiteLLM spend/request logs
#   gateway  -> FastAPI app data (users, usage_logs, purchases)
# Runs once, on first volume initialization, as the POSTGRES_USER superuser.
set -eu

if [ -z "${POSTGRES_MULTIPLE_DATABASES:-}" ]; then
    echo "POSTGRES_MULTIPLE_DATABASES is empty - nothing to create."
    exit 0
fi

for db in $(echo "$POSTGRES_MULTIPLE_DATABASES" | tr ',' ' '); do
    if [ -z "$db" ]; then
        continue
    fi
    echo "Creating database '$db' ..."
    # POSIX sh (busybox ash): pipe the statement in instead of using a
    # bash-only here-string.
    echo "CREATE DATABASE \"$db\";" \
        | psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres
done
